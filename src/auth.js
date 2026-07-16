// Authentication: token-based sessions stored in SQLite.
const crypto = require("crypto");
const { db, verifyPassword, hashPassword } = require("./db");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });

  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.property_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?`).get(token);

  if (!row) return res.status(401).json({ error: "Session expired — sign in again" });
  req.user = row;
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function registerAuthRoutes(app) {
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Incorrect email or password" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, user.id);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  });

  app.post("/api/auth/logout", requireAuth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(req.token);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

  app.post("/api/auth/change-password", requireAuth, (req, res) => {
    const { current, next: nextPassword } = req.body || {};
    if (!nextPassword || nextPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!verifyPassword(current || "", user.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(hashPassword(nextPassword), req.user.id);
    res.json({ ok: true });
  });

  app.post("/api/users", requireAuth, requireAdmin, (req, res) => {
    const { name, email, password, role = "staff", property_id = null } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required" });
    }
    try {
      const id = db.prepare(`
        INSERT INTO users (name, email, password_hash, role, property_id)
        VALUES (?, ?, ?, ?, ?)`)
        .run(name.trim(), email.trim().toLowerCase(), hashPassword(password), role, property_id)
        .lastInsertRowid;
      res.status(201).json({ id });
    } catch (e) {
      res.status(400).json({ error: "A user with that email already exists" });
    }
  });

  app.get("/api/users", requireAuth, requireAdmin, (req, res) => {
    res.json(db.prepare("SELECT id, name, email, role, property_id FROM users").all());
  });
}

module.exports = { requireAuth, requireAdmin, registerAuthRoutes };
