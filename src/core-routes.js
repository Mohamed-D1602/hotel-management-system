// Core resource routes: brands, properties, room types, rooms, guests.
const { db } = require("./db");
const { requireAuth, requireAdmin } = require("./auth");

function registerCoreRoutes(app) {
  // ---------------- brands ----------------
  app.get("/api/brands", requireAuth, (req, res) => {
    res.json(db.prepare("SELECT * FROM brands ORDER BY name").all());
  });

  app.post("/api/brands", requireAuth, requireAdmin, (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "Brand name is required" });
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
    try {
      const id = db.prepare("INSERT INTO brands (name, slug) VALUES (?, ?)")
        .run(name.trim(), slug).lastInsertRowid;
      res.status(201).json({ id });
    } catch {
      res.status(400).json({ error: "A brand with that name already exists" });
    }
  });

  // ---------------- properties ----------------
  app.get("/api/properties", requireAuth, (req, res) => {
    res.json(db.prepare(`
      SELECT p.*, b.name AS brand_name
      FROM properties p JOIN brands b ON b.id = p.brand_id
      WHERE p.active = 1 ORDER BY b.name, p.name`).all());
  });

  app.post("/api/properties", requireAuth, requireAdmin, (req, res) => {
    const { brand_id, name, city, country, address = "", phone = "",
            currency = "USD", timezone = "UTC" } = req.body || {};
    if (!brand_id || !name || !city || !country) {
      return res.status(400).json({ error: "Brand, name, city and country are required" });
    }
    const id = db.prepare(`
      INSERT INTO properties (brand_id, name, city, country, address, phone, currency, timezone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(brand_id, name.trim(), city.trim(), country.trim(), address, phone, currency, timezone)
      .lastInsertRowid;
    res.status(201).json({ id });
  });

  app.put("/api/properties/:id", requireAuth, requireAdmin, (req, res) => {
    const { name, city, country, address, phone, currency, timezone } = req.body || {};
    const p = db.prepare("SELECT * FROM properties WHERE id = ?").get(req.params.id);
    if (!p) return res.status(404).json({ error: "Property not found" });
    db.prepare(`
      UPDATE properties SET name=?, city=?, country=?, address=?, phone=?, currency=?, timezone=?
      WHERE id=?`)
      .run(name ?? p.name, city ?? p.city, country ?? p.country, address ?? p.address,
           phone ?? p.phone, currency ?? p.currency, timezone ?? p.timezone, p.id);
    res.json({ ok: true });
  });

  // ---------------- room types ----------------
  app.get("/api/properties/:id/room-types", requireAuth, (req, res) => {
    res.json(db.prepare(
      "SELECT * FROM room_types WHERE property_id = ? ORDER BY base_rate, name"
    ).all(req.params.id));
  });

  app.post("/api/properties/:id/room-types", requireAuth, (req, res) => {
    const { name, description = "", capacity = 2, base_rate = 0 } = req.body || {};
    if (!name) return res.status(400).json({ error: "Room type name is required" });
    try {
      const id = db.prepare(`
        INSERT INTO room_types (property_id, name, description, capacity, base_rate)
        VALUES (?, ?, ?, ?, ?)`)
        .run(req.params.id, name.trim(), description, capacity, base_rate).lastInsertRowid;
      res.status(201).json({ id });
    } catch {
      res.status(400).json({ error: "That room type already exists for this property" });
    }
  });

  app.put("/api/room-types/:id", requireAuth, (req, res) => {
    const t = db.prepare("SELECT * FROM room_types WHERE id = ?").get(req.params.id);
    if (!t) return res.status(404).json({ error: "Room type not found" });
    const { name, description, capacity, base_rate } = req.body || {};
    db.prepare(`
      UPDATE room_types SET name=?, description=?, capacity=?, base_rate=? WHERE id=?`)
      .run(name ?? t.name, description ?? t.description,
           capacity ?? t.capacity, base_rate ?? t.base_rate, t.id);
    res.json({ ok: true });
  });

  // ---------------- rooms ----------------
  app.get("/api/properties/:id/rooms", requireAuth, (req, res) => {
    res.json(db.prepare(`
      SELECT r.*, t.name AS room_type_name, t.base_rate
      FROM rooms r JOIN room_types t ON t.id = r.room_type_id
      WHERE r.property_id = ?
      ORDER BY CAST(r.number AS INTEGER), r.number`).all(req.params.id));
  });

  app.post("/api/properties/:id/rooms", requireAuth, (req, res) => {
    const { room_type_id, number, floor = null } = req.body || {};
    if (!room_type_id || !number) {
      return res.status(400).json({ error: "Room number and room type are required" });
    }
    try {
      const id = db.prepare(`
        INSERT INTO rooms (property_id, room_type_id, number, floor)
        VALUES (?, ?, ?, ?)`)
        .run(req.params.id, room_type_id, String(number).trim(), floor).lastInsertRowid;
      res.status(201).json({ id });
    } catch {
      res.status(400).json({ error: "That room number already exists at this property" });
    }
  });

  app.put("/api/rooms/:id", requireAuth, (req, res) => {
    const r = db.prepare("SELECT * FROM rooms WHERE id = ?").get(req.params.id);
    if (!r) return res.status(404).json({ error: "Room not found" });
    const { room_type_id, number, floor, status, housekeeping } = req.body || {};
    db.prepare(`
      UPDATE rooms SET room_type_id=?, number=?, floor=?, status=?, housekeeping=? WHERE id=?`)
      .run(room_type_id ?? r.room_type_id, number ?? r.number, floor ?? r.floor,
           status ?? r.status, housekeeping ?? r.housekeeping, r.id);
    res.json({ ok: true });
  });

  // ---------------- guests ----------------
  app.get("/api/guests", requireAuth, (req, res) => {
    const q = (req.query.q || "").trim();
    if (q) {
      const like = `%${q}%`;
      return res.json(db.prepare(`
        SELECT * FROM guests
        WHERE full_name LIKE ? OR email LIKE ? OR phone LIKE ?
        ORDER BY full_name LIMIT 50`).all(like, like, like));
    }
    res.json(db.prepare("SELECT * FROM guests ORDER BY created_at DESC LIMIT 100").all());
  });

  app.post("/api/guests", requireAuth, (req, res) => {
    const { full_name, email = "", phone = "", nationality = "",
            id_document = "", notes = "" } = req.body || {};
    if (!full_name) return res.status(400).json({ error: "Guest name is required" });
    const id = db.prepare(`
      INSERT INTO guests (full_name, email, phone, nationality, id_document, notes)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(full_name.trim(), email, phone, nationality, id_document, notes).lastInsertRowid;
    res.status(201).json({ id });
  });

  app.put("/api/guests/:id", requireAuth, (req, res) => {
    const g = db.prepare("SELECT * FROM guests WHERE id = ?").get(req.params.id);
    if (!g) return res.status(404).json({ error: "Guest not found" });
    const { full_name, email, phone, nationality, id_document, notes } = req.body || {};
    db.prepare(`
      UPDATE guests SET full_name=?, email=?, phone=?, nationality=?, id_document=?, notes=?
      WHERE id=?`)
      .run(full_name ?? g.full_name, email ?? g.email, phone ?? g.phone,
           nationality ?? g.nationality, id_document ?? g.id_document, notes ?? g.notes, g.id);
    res.json({ ok: true });
  });
}

module.exports = { registerCoreRoutes };
