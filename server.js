const express = require("express");
console.log("LOADED:", __filename);

app.get("/_debug_routes", (_req, res) => {
  const routes = app._router.stack
    .filter(r => r.route)
    .map(r => Object.keys(r.route.methods)[0].toUpperCase() + " " + r.route.path);
  res.json({ routes });
});

const path = require("path");
const session = require("express-session");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const db = new sqlite3.Database(path.join(__dirname, "laka.db"));

app.use(express.json());

app.use(
  session({
    secret: "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true },
  })
);

// Helpful logger
app.use((req, _res, next) => {
  console.log(req.method, req.url);
  next();
});

// Static files
app.use(express.static(path.join(__dirname, "public")));

/* ------------------ CLEAN PAGE ROUTES ------------------ */
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "Laka.html"));
});

app.get("/community", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "community.html"));
});

app.get("/profile", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"));
});

/* ------------------ DB setup ------------------ */
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      bio TEXT DEFAULT ''
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      friend_user_id INTEGER NOT NULL,
      UNIQUE(user_id, friend_user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS events_attended (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_title TEXT NOT NULL,
      event_date TEXT,
      location TEXT,
      created_at INTEGER NOT NULL
    )
  `);
});

/* ------------------ helpers ------------------ */
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}

function getUserById(id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, display_name, username, email, bio FROM users WHERE id = ?`,
      [id],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}

/* ------------------ auth routes ------------------ */
app.post("/api/signup", async (req, res) => {
  try {
    const { display_name, username, email, password } = req.body || {};
    if (!display_name || !username || !email || !password) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO users (display_name, username, email, password_hash) VALUES (?, ?, ?, ?)`,
      [display_name, username, email, password_hash],
      function (err) {
        if (err) {
          const msg = String(err.message || "");
          if (msg.includes("UNIQUE")) return res.status(400).json({ error: "Username or email already exists" });
          return res.status(500).json({ error: "DB error" });
        }
        req.session.userId = this.lastID;
        res.json({ ok: true });
      }
    );
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing fields" });

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!user) return res.status(400).json({ error: "Invalid email or password" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: "Invalid email or password" });

    req.session.userId = user.id;
    res.json({ ok: true });
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireAuth, async (req, res) => {
  const user = await getUserById(req.session.userId);
  res.json({ user });
});

app.post("/api/me/bio", requireAuth, (req, res) => {
  const { bio } = req.body || {};
  db.run(`UPDATE users SET bio = ? WHERE id = ?`, [bio || "", req.session.userId], (err) => {
    if (err) return res.status(500).json({ error: "DB error" });
    res.json({ ok: true });
  });
});

app.get("/api/me/friends", requireAuth, (req, res) => {
  db.all(
    `
    SELECT u.id, u.display_name, u.username
    FROM friends f
    JOIN users u ON u.id = f.friend_user_id
    WHERE f.user_id = ?
    ORDER BY u.username ASC
    `,
    [req.session.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json({ friends: rows });
    }
  );
});

app.post("/api/me/friends/add", requireAuth, (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: "Missing username" });

  db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, row) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!row) return res.status(404).json({ error: "User not found" });
    if (row.id === req.session.userId) return res.status(400).json({ error: "Cannot add yourself" });

    db.run(
      `INSERT OR IGNORE INTO friends (user_id, friend_user_id) VALUES (?, ?)`,
      [req.session.userId, row.id],
      (err2) => {
        if (err2) return res.status(500).json({ error: "DB error" });
        res.json({ ok: true });
      }
    );
  });
});

app.get("/api/me/events", requireAuth, (req, res) => {
  db.all(
    `SELECT event_title, event_date, location, created_at
     FROM events_attended
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [req.session.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json({ events: rows });
    }
  );
});

app.post("/api/me/events/attend", requireAuth, (req, res) => {
  const { event_title, event_date, location } = req.body || {};
  if (!event_title) return res.status(400).json({ error: "Event title required" });

  db.run(
    `INSERT INTO events_attended (user_id, event_title, event_date, location, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [req.session.userId, event_title, event_date || null, location || null, Date.now()],
    (err) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json({ ok: true });
    }
  );
});

app.get("/api/me/impact", requireAuth, (req, res) => {
  const KG_PER_EVENT = 1.8;

  db.get(`SELECT COUNT(*) as cnt FROM events_attended WHERE user_id = ?`, [req.session.userId], (err, row) => {
    if (err) return res.status(500).json({ error: "DB error" });
    const events = row?.cnt || 0;
    const kg_saved = Number((events * KG_PER_EVENT).toFixed(1));
    res.json({ events, kg_saved, kg_per_event: KG_PER_EVENT });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
