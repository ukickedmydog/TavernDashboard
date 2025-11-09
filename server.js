// ==========================================
// Tavern Dashboard — Multi-Page Version
// ==========================================
import express from "express";
import session from "express-session";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ==========================================
// SESSION CONFIG
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
      maxAge: 1000 * 60 * 60 * 24,
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

const GITHUB_JSON_URL =
  "https://raw.githubusercontent.com/ukickedmydog/TavernDashboard/main/TavernPlayers.json";

// ==========================================
// HELPER — Normalize player data
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
    (Array.isArray(parsed) ? parsed : []);
  const normalizedPlayers = players.map((p) => ({
    username: p.username || "",
    usernameLower: (p.username || "").toLowerCase(),
    currentTitle: p.currentTitle || "Regular",
    gold: p.gold || 0,
    health: p.health || 100,
    drunkenness: p.drunkenness || 0,
    honour: p.honour || 0,
    questsCompleted: p.questsCompleted || 0,
    inventory: p.inventory || [],
  }));
  return normalizedPlayers;
}

// ==========================================
// GITHUB FETCH (no cache, always fresh)
// ==========================================
async function loadLedger() {
  try {
    const res = await fetch(`${GITHUB_JSON_URL}?t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
    });
    const text = await res.text();
    return normalizeData(text);
  } catch (err) {
    console.error("[TAVERN] Failed to fetch data:", err.message);
    return [];
  }
}

// ==========================================
// TWITCH AUTH
// ==========================================
app.get("/auth/twitch", (req, res) => {
  const url =
    `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=user:read:email`;
  res.redirect(url);
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
  if (!token.access_token) return res.status(400).send("Failed to get access token.");

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
// PAGES
// ==========================================
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.get("/shop", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "shop.html"))
);

app.get("/contact", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "contact.html"))
);

// ==========================================
// STATUS PAGE
// ==========================================
app.get("/status", async (req, res) => {
  const user = (req.query.user || "").toLowerCase();
  const players = await loadLedger();
  const player = players.find((p) => p.usernameLower === user);

  if (!player)
    return res.send(
      `<html><body style="font-family:cinzel;color:#e6d7b8;background:#1c1a18;padding:50px;text-align:center">
        <h2>No data found for ${user}</h2>
        <p>Speak once in chat to be recorded, then refresh.</p>
        <a href="/">Back to the Tavern</a>
      </body></html>`
    );

  res.send(`
  <html>
  <head>
    <title>${player.username}'s Status</title>
    <link rel="stylesheet" href="/css/tavern-style.css">
  </head>
  <body>
    <div class="container">
      <div class="card">
        <h1>${player.username} — ${player.currentTitle}</h1>
        <p>Health: ${player.health}/100 | Gold: ${player.gold} | Drunkenness: ${player.drunkenness} | Honour: ${player.honour}</p>
        <p>Quests Completed: ${player.questsCompleted}</p>
        <p><b>Inventory:</b> ${player.inventory.length ? player.inventory.join(", ") : "None"}</p>
        <p><a href="/">Return to Tavern</a></p>
      </div>
    </div>
  </body>
  </html>
  `);
});

// ==========================================
app.listen(PORT, () =>
  console.log(`🍺 Tavern Dashboard running on http://localhost:${PORT}`)
);
