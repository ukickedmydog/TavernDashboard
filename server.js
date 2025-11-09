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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${player.username} — Tavern Ledger</title>
  <link rel="stylesheet" href="/css/tavern-style.css">
  <style>
    /* Ledger-specific visual style */
    .ledger {
      background: url('https://www.transparenttextures.com/patterns/paper-fibers.png'),
                  radial-gradient(circle at center, rgba(60,40,20,0.8) 0%, rgba(25,18,10,0.95) 100%);
      background-blend-mode: multiply;
      border: 3px solid #c7a358;
      border-radius: 16px;
      box-shadow:
        0 0 40px rgba(255, 220, 160, 0.2),
        inset 0 0 60px rgba(80, 60, 30, 0.6);
      padding: 3rem 3.5rem;
      margin: 3rem auto;
      max-width: 800px;
      text-align: center;
      color: #f9e6c5;
      font-family: 'EB Garamond', serif;
      position: relative;
      overflow: hidden;
    }

    .ledger::before {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 30% 30%, rgba(255,230,160,0.15), transparent 70%),
                  radial-gradient(circle at 70% 70%, rgba(255,200,100,0.1), transparent 70%);
      mix-blend-mode: screen;
      pointer-events: none;
      z-index: 0;
    }

    .ledger h2 {
      font-family: 'Cinzel Decorative', serif;
      font-size: 2rem;
      color: #ffde9e;
      text-shadow: 0 0 15px rgba(255,220,160,0.3);
      margin-bottom: 1rem;
      position: relative;
      z-index: 1;
    }

    .ledger p {
      position: relative;
      z-index: 1;
      font-size: 1.1rem;
      margin: 0.6rem 0;
    }

    .ledger .muted {
      color: #d6ba7a;
      font-size: 0.95rem;
    }

    .ledger .btn {
      text-decoration: none;
      color: #2a1e0e;
      background: #e6c06d;
      padding: 10px 25px;
      border-radius: 8px;
      font-weight: bold;
      display: inline-block;
      margin-top: 1rem;
      box-shadow: 0 0 10px rgba(255, 235, 160, 0.5);
      transition: all 0.2s ease-in-out;
    }

    .ledger .btn:hover {
      background: #f5d890;
      transform: scale(1.05);
    }

  </style>
</head>
<body>
  <header>
    <nav class="nav-bar">
      <a href="/">Home</a>
      <a href="/shop">Shop</a>
      <a href="/status" class="active">Status</a>
      <a href="/contact">Contact</a>
    </nav>
    <h1>The Tavern Ledger</h1>
    <p class="subtitle">Where every patron’s deeds are inked into eternity...</p>
  </header>

  <main>
    <div class="ledger">
      <h2>${player.username} — ${player.currentTitle}</h2>
      <p><b>Health:</b> ${player.health}/100</p>
      <p><b>Gold:</b> ${player.gold}</p>
      <p><b>Drunkenness:</b> ${player.drunkenness}</p>
      <p><b>Honour:</b> ${player.honour}</p>
      <p><b>Quests Completed:</b> ${player.questsCompleted}</p>
      <p><b>Inventory:</b> ${player.inventory.length ? player.inventory.join(", ") : "None"}</p>
      <p class="muted">Last updated: ${lastUpdated}</p>
      <p><a href="/logout" class="btn">Logout</a></p>
    </div>
  </main>

  <footer>
    © 2025 Dog of the Occult Tavern — <a href="https://twitch.tv/dogoftheoccult">Visit on Twitch</a>
  </footer>

  <script>
    let seconds = 15;
    const ledger = document.querySelector('.ledger');
    const timer = document.createElement('p');
    timer.className = 'muted';
    ledger.appendChild(timer);
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

  // ✅ FIX: define lastUpdated before using it
  const lastUpdated = ledger.lastUpdated
    ? new Date(ledger.lastUpdated).toLocaleString()
    : "Unknown";

});

// ==========================================
app.listen(PORT, () =>
  console.log(`🍺 Tavern Dashboard running on http://localhost:${PORT}`)
);
