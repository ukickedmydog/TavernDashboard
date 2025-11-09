// ==========================================
// 🏰 Tavern Dashboard - Multi-Page Version
// ==========================================
import express from "express";
import session from "express-session";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

// Resolve current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serves CSS + HTML files

// ==========================================
// SESSION
// ==========================================
app.use(
  session({
    secret: process.env.SESSION_SECRET || "tavernsecret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: "none",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  })
);

// ==========================================
// CONFIG
// ==========================================
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.REDIRECT_URI ||
  "https://taverndashboard.onrender.com/auth/twitch/callback";

// 🔗 Your GitHub TavernPlayers.json
const GITHUB_JSON_URL =
  "https://raw.githubusercontent.com/ukickedmydog/TavernDashboard/main/TavernPlayers.json";

// ==========================================
// DATA HANDLING
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
      currentTitle:
        Array.isArray(p.titles) && p.titles.length
          ? p.currentTitle || p.titles[0] || "Regular"
          : p.currentTitle || "Regular",
      titles: Array.isArray(p.titles) ? p.titles : ["Regular"],
      gold: Number.isFinite(p.gold) ? p.gold : 0,
      health: Number.isFinite(p.health) ? p.health : 100,
      drunkenness: Number.isFinite(p.drunkenness) ? p.drunkenness : 0,
      honour: Number.isFinite(p.honour) ? p.honour : 0,
      questsCompleted: Number.isFinite(p.questsCompleted)
        ? p.questsCompleted
        : 0,
      inventory: Array.isArray(p.inventory) ? p.inventory : [],
    };
  });

  const lastUpdated = parsed.lastUpdated || new Date().toISOString();
  return { lastUpdated, players: normalizedPlayers };
}

// ==========================================
// FETCH PLAYER DATA DIRECTLY FROM GITHUB (CACHED 15s)
// ==========================================
let cachedLedger = null;
let lastFetchTime = 0;

async function loadLedger() {
  const now = Date.now();
  const cacheDuration = 15 * 1000;

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
    cachedLedger = data;
    lastFetchTime = now;
    return data;
  } catch (err) {
    console.error("[TAVERN] Failed to fetch data:", err.message);
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
// FRONTEND PAGES
// ==========================================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/shop", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "shop.html"));
});

app.get("/contact", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "contact.html"));
});

// ==========================================
// STATUS PAGE
// ==========================================
app.get("/status", async (req, res) => {
  const userSession = req.session?.username;
  const user = (req.query.user || userSession || "").toLowerCase();

  if (!user) return res.redirect("/auth/twitch");

  const ledger = await loadLedger();
  const player = ledger.players.find((p) => p.usernameLower === user);

  if (!player) {
    return res.send(`
      <html><head><title>No data</title>
      <link rel="stylesheet" href="/css/tavern-style.css">
      </head>
      <body>
      <nav class="nav-bar">
        <a href="/">Home</a>
        <a href="/shop">Shop</a>
        <a href="/auth/twitch" class="active">Status</a>
        <a href="/contact">Contact</a>
      </nav>
      <main>
        <section>
          <h2>No data found for <b>${user || "(no user given)"}</b></h2>
          <p>Tip: speak once in chat so the Tavern can record you, then refresh.</p>
          <p><a href="/">Back to Tavern Ledger</a></p>
        </section>
      </main>
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
      <link rel="stylesheet" href="/css/tavern-style.css">
    </head>
    <body>
      <nav class="nav-bar">
        <a href="/">Home</a>
        <a href="/shop">Shop</a>
        <a href="/auth/twitch" class="active">Status</a>
        <a href="/contact">Contact</a>
      </nav>
      <main>
        <section class="card">
          <h1>${player.username} — ${player.currentTitle}</h1>
          <p>Health: ${player.health}/100 | Gold: ${player.gold} | Drunkenness: ${player.drunkenness} | Honour: ${player.honour}</p>
          <p>Quests Completed: ${player.questsCompleted}</p>
          <p><b>Inventory:</b> ${player.inventory.length ? player.inventory.join(", ") : "None"}</p>
          <p class="muted">Last updated: ${lastUpdated}</p>
          <p><a href="/logout">Logout</a></p>
        </section>
      </main>
      <script>
        let seconds = 15;
        const timer = document.createElement("p");
        timer.className = "muted";
        document.querySelector(".card").appendChild(timer);
        function tick(){
          timer.textContent = "Refreshing in " + seconds + "s...";
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
  console.log(`🍺 Tavern Dashboard running on http://localhost:${PORT}`)
);
