// --- Imports ---
import express from "express";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.static("public"));

const PORT = 3000;

// ----------------------------------------------------
//  Twitch app credentials (get these from dev.twitch.tv)
// ----------------------------------------------------
const CLIENT_ID = "287afxhyn3b4kz73zo1hc3x0i8a2mp";
const CLIENT_SECRET = "7ayxsctnd4ase6iqsinj01cloqszua";  // replace with your own
const REDIRECT_URI = "https://taverndashboard.onrender.com/auth/twitch/callback";

// ----------------------------------------------------
// ----------------------------------------------------
//  Location of Unity save file
const PLAYER_DATA_PATH = path.resolve("./TavernPlayers.json");

// ====================================================
//  STEP 1 — Twitch OAuth login
// ====================================================

app.get("/auth/twitch", (req, res) => {
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=user:read:email`;
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
  const username = userData.data?.[0]?.login?.toLowerCase();
  if (!username) return res.status(400).send("Could not fetch Twitch user.");

  res.redirect(`/status?user=${username}`);
});

// ====================================================
//  STEP 2 — Serve player status from Unity JSON
// ====================================================

app.get("/status", (req, res) => {
  const user = req.query.user?.toLowerCase();
  if (!user) return res.send("<h3>No user specified.</h3>");

  try {
    const json = fs.readFileSync(PLAYER_DATA_PATH, "utf8");
    const parsed = JSON.parse(json);
	const lastUpdated = parsed.lastUpdated
  ? new Date(parsed.lastUpdated).toLocaleString()
  : "Unknown";


    // Match your PlayerListWrapper structure
    const player = parsed.players?.find(p => p.username === user);
    if (!player)
      return res.send(`<h2>No data found for <b>${user}</b></h2>`);

    res.send(`
      <html>
      <head>
        <title>${player.username}'s Tavern Status</title>
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
            padding: 20px;
            max-width: 400px;
            background: #2a2623;
          }
          h1 { color: #e8c676; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>${player.username}</h1>
          <p><b>Title:</b> ${player.currentTitle}</p>
          <p><b>Health:</b> ${player.health}/100</p>
          <p><b>Gold:</b> ${player.gold}</p>
          <p><b>Drunkenness:</b> ${player.drunkenness}</p>
          <p><b>Honour:</b> ${player.honour}</p>
          <p><b>Inventory:</b> ${player.inventory?.join(", ") || "None"}</p>
          <p><b>Quests Completed:</b> ${player.questsCompleted}</p>
		  <p style="font-size: 0.9em; color: #bda676;">
  Last updated: ${lastUpdated}
</p>

        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error reading player file: " + err.message);
  }
});

// ====================================================
//  Secure upload endpoint (requires UPLOAD_KEY header)
// ====================================================
app.post("/api/upload", express.json({ limit: "5mb" }), (req, res) => {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.UPLOAD_KEY}`)
    return res.status(401).send("Unauthorized");

  try {
    const { lastUpdated, data } = req.body;
    const wrapped = {
      lastUpdated: lastUpdated || new Date().toISOString(),
      players: data.playerList || data.players || []
    };

    fs.writeFileSync("./TavernPlayers.json", JSON.stringify(wrapped, null, 2));
    console.log(`✅ Player data updated (${wrapped.players.length} players).`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to save player data:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});




app.listen(PORT, () =>
  console.log(`🍺 Tavern Dashboard running at http://localhost:${PORT}`)
);
