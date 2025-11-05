// server.js (ESM)
// ----------------------------------------------------
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// 🔐 Twitch app credentials
const CLIENT_ID = process.env.TWITCH_CLIENT_ID || "YOUR_CLIENT_ID";
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || "YOUR_CLIENT_SECRET";
// Make sure this matches your Twitch app exactly
const REDIRECT_URI =
  process.env.REDIRECT_URI ||
  "https://taverndashboard.onrender.com/auth/twitch/callback";

// 📄 Where the data file lives (repo root on Render)
const PLAYER_DATA_PATH = path.resolve("./TavernPlayers.json");

// ----------------------------------------------------
// Helpers: load + normalize player data
// ----------------------------------------------------
function safeReadFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    // Create a minimal file if missing
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

  // Handle different possible root layouts
  const data = parsed.data || parsed;
  const players =
    data.players ||
    data.playerList ||
    (Array.isArray(data) ? data : []);

  // Normalize players
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

// ----------------------------------------------------
// OAuth: Start + Callback
// ----------------------------------------------------
app.get("/auth/twitch", (req, res) => {
  const authUrl =
    `https://id.twitch.tv/oauth2/authorize?` +
    `client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
      REDIRECT_URI
    )}&response_type=code&scope=user:read:email`;
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

  const userRes = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      "Client-ID": CLIENT_ID,
      Authorization: `Bearer ${token.access_token}`,
    },
  });
  const userData = await userRes.json();
  const username = userData?.data?.[0]?.login?.toLowerCase();

  if (!username) return res.status(400).send("Could not fetch Twitch user.");
  res.redirect(`/status?user=${encodeURIComponent(username)}`);
});

// ----------------------------------------------------
// Secure upload endpoint (Unity → Render live sync)
// Requires: header Authorization: Bearer <UPLOAD_KEY>
// ----------------------------------------------------
app.post("/api/upload", express.json({ limit: "5mb" }), (req, res) => {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.UPLOAD_KEY}`) {
    console.warn("Unauthorized upload attempt blocked.");
    return res.status(401).send("Unauthorized");
  }
  try {
    // Accept wrapped format { lastUpdated, data:{players or playerList} }
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
    console.error("Failed to save player data:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// JSON APIs (handy for overlays/extensions later)
// ----------------------------------------------------
app.get("/api/player", (req, res) => {
  const user = (req.query.user || "").toLowerCase();
  const { ledger, player } = getPlayerByLogin(user);
  if (!player) return res.status(404).json({ error: "Player not found" });
  res.json({ lastUpdated: ledger.lastUpdated, player });
});

app.get("/api/all", (req, res) => {
  const ledger = loadLedger();
  res.json(ledger);
});

// ----------------------------------------------------
// Status page
// ----------------------------------------------------
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
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
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

// ----------------------------------------------------
app.listen(PORT, () =>
  console.log(`🍺 Tavern Dashboard running at http://localhost:${PORT}`)
);
