// ==========================================
// Tavern Dashboard — Final (Persistent Sessions)
// ==========================================
import express from "express";
import session from "express-session";
import FileStoreFactory from "session-file-store";
import fs from "fs";
import path from "path";
import cors from "cors";
import fetch from "node-fetch";

if (!fs.existsSync("./sessions")) fs.mkdirSync("./sessions");

// ==========================================
// CONFIGURATION
// ==========================================
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.REDIRECT_URI ||
  "https://taverndashboard.onrender.com/auth/twitch/callback";

const PLAYER_DATA_PATH =
  process.env.PLAYER_DATA_PATH || path.resolve("./TavernPlayers.json");

// ==========================================
// APP INITIALIZATION
// ==========================================
const app = express();
app.use(cors());
app.use(express.static("public"));
app.use(express.json());

// ==========================================
// SESSION (PERSISTENT)
// ==========================================
app.set("trust proxy", 1); // ✅ required for secure cookies behind Render proxy

app.use(
  session({
    secret: process.env.SESSION_SECRET || "tavernsecret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,         // ✅ only send over HTTPS
      httpOnly: true,       // ✅ prevents JS access to cookie
      sameSite: "none",     // ✅ required for cross-site OAuth
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);


// ==========================================
// DATA HELPERS
// ==========================================
function safeReadFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    const blank = { lastUpdated: "Never", players: [] };
    fs.writeFileSync(p, JSON.stringify(blank, null, 2));
    return JSON.stringify(blank);
  }
}

function normalizeData(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    parsed = { lastUpdated: "Never", players: [] };
  }

  const data = parsed.data || parsed;
  const players =
    data.players || data.playerList || (Array.isArray(data) ? data : []);

  const normalizedPlayers = players.map((p) => {
    const uname = p.username || p.name || p.user || "";
    return {
      username: uname,
      usernameLower: uname.toLowerCase(),
      currentTitle: p.currentTitle || "Regular",
      titles: Array.isArray(p.titles) ? p.titles : ["Regular"],
      gold: p.gold ?? 0,
      health: p.health ?? 100,
      drunkenness: p.drunkenness ?? 0,
      honour: p.honour ?? 0,
      questsCompleted: p.questsCompleted ?? 0,
      inventory: Array.isArray(p.inventory) ? p.inventory : [],
    };
  });

  const lastUpdated = parsed.lastUpdated || new Date().toISOString();
  return { lastUpdated, players: normalizedPlayers };
}

function loadLedger() {
  const raw = safeReadFile(PLAYER_DATA_PATH);
  return normalizeData(raw);
}

function getPlayerByLogin(login) {
  const ledger = loadLedger();
  const userLower = (login || "").toLowerCase();
  const found = ledger.players.find((p) => p.usernameLower === userLower);
  return { ledger, player: found };
}

// ==========================================
// TWITCH AUTH
// ==========================================
app.get("/auth/twitch", (req, res) => {
  const authUrl =
    `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=user:read:email`;
  res.redirect(authUrl);
});

app.get("/auth/twitch/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("No code returned from Twitch.");

  const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });

  const token = await tokenRes.json();
  if (!token.access_token) {
    console.error("OAuth token fetch failed:", token);
    return res.status(400).send("Failed to get access token.");
  }

  const userRes = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      "Client-ID": CLIENT_ID,
      Authorization: `Bearer ${token.access_token}`,
    },
  });

  const userData = await userRes.json();
  const username = userData?.data?.[0]?.login?.toLowerCase();

  if (!username) return res.status(400).send("Could not fetch Twitch user.");

  // ✅ Store username in session (persistent)
  req.session.username = username;
  req.session.save(() => {
    console.log(`[LOGIN] ${username} logged in.`);
    res.redirect("/");
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ==========================================
// UNITY UPLOAD ENDPOINT
// ==========================================
app.post("/api/upload", express.json({ limit: "5mb" }), (req, res) => {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.UPLOAD_KEY}`) {
    console.warn("Unauthorized upload attempt blocked.");
    return res.status(401).send("Unauthorized");
  }

  try {
    const { lastUpdated, data } = req.body || {};
    const wrapped = normalizeData(
      JSON.stringify(
        data
          ? { lastUpdated: lastUpdated || new Date().toISOString(), ...data }
          : req.body
      )
    );
    fs.writeFileSync(PLAYER_DATA_PATH, JSON.stringify(wrapped, null, 2));
    console.log(`✅ Player data updated (${wrapped.players.length} players).`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to save player data:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// FRONTEND ROUTES
// ==========================================
app.get("/", (req, res) => {
  const user = req.session?.username;

  // ✅ If session username is missing, but Twitch stored a cookie, reload from query
  if (!user && req.query.user) {
    req.session.username = req.query.user.toLowerCase();
  }

  // ✅ If we now have a username, send them straight to their dashboard
  if (req.session.username) {
    console.log("[SESSION] Redirecting", req.session.username, "to /status");
    return res.redirect(`/status?user=${encodeURIComponent(req.session.username)}`);
  }

  // otherwise show login screen
  res.send(`
    <html>
      <head>
        <title>The Tavern Ledger</title>
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap" rel="stylesheet">
        <style>
          body {
            background: #1c1a18;
            color: #d9c79e;
            font-family: 'Cinzel', serif;
            text-align: center;
            padding: 80px;
          }
          .card {
            border: 2px solid #a27c49;
            border-radius: 12px;
            padding: 40px;
            display: inline-block;
            background: #2a2623;
            box-shadow: 0 0 20px rgba(255,220,160,0.1);
          }
          a.button {
            display: inline-block;
            padding: 12px 30px;
            background: #a27c49;
            color: #1c1a18;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
            font-size: 18px;
          }
          a.button:hover { background: #d4a96f; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>The Tavern Ledger</h1>
          <p>Record of all patrons who brave the firelight...</p>
          <a href="/auth/twitch" class="button">Enter the Tavern</a>
        </div>
      </body>
    </html>
  `);
});


app.get("/status", (req, res) => {
  const user = (req.query.user || "").toLowerCase();
  const { ledger, player } = getPlayerByLogin(user);

  if (!player) {
    return res.send(`
      <html><head><title>No data</title>
      <style>
        body{background:#1c1a18;color:#d9c79e;font-family:Cinzel,serif;padding:40px}
        .card{border:2px solid #a27c49;border-radius:12px;padding:20px;max-width:520px;background:#2a2623}
      </style></head>
      <body>
        <div class="card">
          <h2>No data found for <b>${user || "(no user given)"}</b></h2>
          <p>Tip: speak once in chat so the Tavern can record you, then refresh.</p>
          <p><a href="/">Back to Tavern Ledger</a></p>
        </div>
      </body></html>
    `);
  }

  const lastUpdated = ledger.lastUpdated
    ? new Date(ledger.lastUpdated).toLocaleString()
    : "Unknown";

  res.send(`
    <html>
    <head>
      <title>${player.username}'s Tavern Status</title>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap" rel="stylesheet">
      <style>
        body {
          background: #1c1a18;
          color: #d9c79e;
          font-family: 'Cinzel', serif;
          padding: 40px;
        }
        .card {
          border: 2px solid #a27c49;
          border-radius: 12px;
          padding: 24px 28px;
          max-width: 560px;
          background: #2a2623;
          box-shadow: 0 0 30px rgba(255,220,160,0.15);
        }
        h1 { color: #e8c676; margin: 0 0 10px; }
        .muted { color:#bda676; font-size: 0.9em; }
        .inv { margin-top: 10px; }
        a { color: #e8c676; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${player.username} — ${player.currentTitle}</h1>
        <p>Health: ${player.health}/100 | Gold: ${player.gold} | Drunkenness: ${player.drunkenness} | Honour: ${player.honour}</p>
        <p>Quests Completed: ${player.questsCompleted}</p>
        <p class="inv"><b>Inventory:</b> ${player.inventory.length ? player.inventory.join(", ") : "None"}</p>
        <p class="muted">Last updated: ${lastUpdated}</p>
        <p class="muted" id="timer"></p>
        <p><a href="/logout">Logout</a></p>
      </div>
      <script>
        let seconds = 60;
        const t = document.getElementById("timer");
        function tick(){
          t.textContent = "Refreshing in " + seconds + "s...";
          seconds--;
          if(seconds <= 0) location.reload();
        }
        tick();
        setInterval(tick, 1000);
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () =>
  console.log(`🍺 Tavern Dashboard running at http://localhost:${PORT}`)
);
