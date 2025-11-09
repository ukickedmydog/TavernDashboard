// ==========================================
// Tavern Dashboard — Live GitHub Data Version
// ==========================================
import express from "express";
import session from "express-session";
import fs from "fs";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";

// ✅ Required for secure cookies behind Render
const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.static("public"));
app.use(express.json());


import path from "path";
app.use(express.static("public"));

app.get("/", (req, res) => res.sendFile(path.resolve("public/index.html")));
app.get("/shop", (req, res) => res.sendFile(path.resolve("public/shop.html")));
app.get("/contact", (req, res) => res.sendFile(path.resolve("public/contact.html")));


// ==========================================
// SESSION (in-memory, stable for HTTPS Render)
// ==========================================
app.use(
  session({
    secret: process.env.SESSION_SECRET || "tavernsecret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,      // HTTPS only
      sameSite: "none",  // allows Twitch OAuth redirect
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  })
);

// ==========================================
// CONFIGURATION
// ==========================================
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.REDIRECT_URI ||
  "https://taverndashboard.onrender.com/auth/twitch/callback";

// ✅ REPLACE THIS with your own GitHub raw file URL
const GITHUB_JSON_URL =
  "https://raw.githubusercontent.com/ukickedmydog/TavernDashboard/main/TavernPlayers.json";


// ==========================================
// DATA HELPERS
// ==========================================
// ==========================================
// NORMALIZE PLAYER DATA (supports playerList/players)
// ==========================================
function normalizeData(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    parsed = {};
  }

  const players =
    parsed.playerList ||
    parsed.players ||
    (parsed.data && (parsed.data.playerList || parsed.data.players)) ||
    (Array.isArray(parsed) ? parsed : []);

  const normalizedPlayers = players.map((p) => {
    const uname = (p.username || p.name || p.user || "").toString();
    return {
      username: uname,
      usernameLower: uname.toLowerCase(),
      currentTitle: Array.isArray(p.titles) && p.titles.length
        ? (p.currentTitle || p.titles[0] || "Regular")
        : (p.currentTitle || "Regular"),
      titles: Array.isArray(p.titles) ? p.titles : ["Regular"],
      gold: Number.isFinite(p.gold) ? p.gold : 0,
      health: Number.isFinite(p.health) ? p.health : 100,
      drunkenness: Number.isFinite(p.drunkenness) ? p.drunkenness : 0,
      honour: Number.isFinite(p.honour) ? p.honour : 0,
      questsCompleted: Number.isFinite(p.questsCompleted) ? p.questsCompleted : 0,
      inventory: Array.isArray(p.inventory) ? p.inventory : [],
    };
  });

  const lastUpdated = parsed.lastUpdated || new Date().toISOString();
  return { lastUpdated, players: normalizedPlayers };
}

// ==========================================
// FETCH PLAYER DATA DIRECTLY FROM GITHUB (CACHED 15 SEC)
// ==========================================
let cachedLedger = null;
let lastFetchTime = 0;

async function loadLedger() {
  const now = Date.now();
  const cacheDuration = 15 * 1000; // 15 seconds

  // ✅ If cache still valid, return cached data
  if (cachedLedger && now - lastFetchTime < cacheDuration) {
    return cachedLedger;
  }

  try {
const res = await fetch(`${GITHUB_JSON_URL}?t=${Date.now()}`, {
  headers: { "Cache-Control": "no-cache" },
});
    if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
    const text = await res.text();
    const data = normalizeData(text);

    // ✅ Save to cache
    cachedLedger = data;
    lastFetchTime = now;

    return data;
  } catch (err) {
    console.error("[TAVERN] Failed to fetch data from GitHub:", err.message);
    // fallback to cached version if available
    if (cachedLedger) return cachedLedger;
    return { lastUpdated: "Never", players: [] };
  }
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

  req.session.username = username;
  req.session.save(() => {
    console.log(`[LOGIN] ${username} logged in.`);
    res.redirect(`/status?user=${encodeURIComponent(username)}`);
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ==========================================
// FRONTEND ROUTES
// ==========================================
app.get("/", (req, res) => {
  const user = req.session?.username;
  if (user) {
    console.log("[SESSION] Redirecting", user, "to /status");
    return res.redirect(`/status?user=${encodeURIComponent(user)}`);
  }

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

app.get("/status", async (req, res) => {
  const user = (req.query.user || "").toLowerCase();
  const ledger = await loadLedger();
  const player = ledger.players.find((p) => p.usernameLower === user);

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
  
  
  // ==========================================
// FRONTEND PAGES
// ==========================================

// 🏠 Home page (About the Tavern)
app.get("/about", (req, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// 🛒 Tavern Shop
app.get("/shop", (req, res) => {
  res.sendFile(path.resolve("public/shop.html"));
});

// 💬 Contact page
app.get("/contact", (req, res) => {
  res.sendFile(path.resolve("public/contact.html"));
});

  
  
  

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
        let seconds = 15;
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
