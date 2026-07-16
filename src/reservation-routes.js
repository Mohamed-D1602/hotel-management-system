// Reservations, availability, check-in / check-out, payments, dashboard.
const { db, reservationCode } = require("./db");
const { requireAuth } = require("./auth");

const OVERLAP_SQL = `
  status IN ('booked','checked_in')
  AND check_in < ?   -- existing starts before requested check-out
  AND check_out > ?  -- existing ends after requested check-in
`;

function nightsBetween(checkIn, checkOut) {
  const a = new Date(checkIn + "T00:00:00Z");
  const b = new Date(checkOut + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function registerReservationRoutes(app) {
  // ---------------- availability ----------------
  // Rooms of a property free for [check_in, check_out), grouped by type.
  app.get("/api/properties/:id/availability", requireAuth, (req, res) => {
    const { check_in, check_out } = req.query;
    if (!isDate(check_in) || !isDate(check_out) || check_out <= check_in) {
      return res.status(400).json({ error: "Provide valid check_in and check_out dates (check_out after check_in)" });
    }
    const rooms = db.prepare(`
      SELECT r.id, r.number, r.floor, t.id AS room_type_id, t.name AS room_type_name,
             t.base_rate, t.capacity
      FROM rooms r JOIN room_types t ON t.id = r.room_type_id
      WHERE r.property_id = ? AND r.status != 'out_of_service'
        AND r.id NOT IN (
          SELECT room_id FROM reservations
          WHERE property_id = ? AND room_id IS NOT NULL AND ${OVERLAP_SQL}
        )
      ORDER BY t.base_rate, CAST(r.number AS INTEGER)`)
      .all(req.params.id, req.params.id, check_out, check_in);
    res.json({ nights: nightsBetween(check_in, check_out), rooms });
  });

  // ---------------- reservations ----------------
  app.get("/api/properties/:id/reservations", requireAuth, (req, res) => {
    const { status, date } = req.query;
    let sql = `
      SELECT res.*, g.full_name AS guest_name, g.phone AS guest_phone,
             r.number AS room_number, t.name AS room_type_name
      FROM reservations res
      JOIN guests g ON g.id = res.guest_id
      JOIN room_types t ON t.id = res.room_type_id
      LEFT JOIN rooms r ON r.id = res.room_id
      WHERE res.property_id = ?`;
    const params = [req.params.id];
    if (status) { sql += " AND res.status = ?"; params.push(status); }
    if (isDate(date)) { sql += " AND res.check_in <= ? AND res.check_out >= ?"; params.push(date, date); }
    sql += " ORDER BY res.check_in DESC, res.id DESC LIMIT 200";
    res.json(db.prepare(sql).all(...params));
  });

  app.post("/api/properties/:id/reservations", requireAuth, (req, res) => {
    const propertyId = Number(req.params.id);
    const { guest_id, room_id = null, room_type_id, check_in, check_out,
            adults = 1, children = 0, nightly_rate = null, notes = "" } = req.body || {};

    if (!guest_id || !room_type_id) {
      return res.status(400).json({ error: "Guest and room type are required" });
    }
    if (!isDate(check_in) || !isDate(check_out) || check_out <= check_in) {
      return res.status(400).json({ error: "Check-out must be after check-in (YYYY-MM-DD)" });
    }

    if (room_id) {
      const clash = db.prepare(`
        SELECT COUNT(*) AS n FROM reservations
        WHERE room_id = ? AND ${OVERLAP_SQL}`)
        .get(room_id, check_out, check_in).n;
      if (clash > 0) {
        return res.status(409).json({ error: "That room is already booked for those dates" });
      }
    }

    const type = db.prepare("SELECT * FROM room_types WHERE id = ?").get(room_type_id);
    if (!type) return res.status(400).json({ error: "Room type not found" });

    const rate = nightly_rate ?? type.base_rate;
    const nights = nightsBetween(check_in, check_out);
    const id = db.prepare(`
      INSERT INTO reservations
        (code, property_id, room_id, room_type_id, guest_id, check_in, check_out,
         adults, children, nightly_rate, total, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(reservationCode(), propertyId, room_id, room_type_id, guest_id,
           check_in, check_out, adults, children, rate, rate * nights, notes)
      .lastInsertRowid;
    res.status(201).json({ id, nights, total: rate * nights });
  });

  function getReservation(id) {
    return db.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
  }

  app.post("/api/reservations/:id/check-in", requireAuth, (req, res) => {
    const r = getReservation(req.params.id);
    if (!r) return res.status(404).json({ error: "Reservation not found" });
    if (r.status !== "booked") {
      return res.status(400).json({ error: `Cannot check in a reservation that is ${r.status}` });
    }
    const roomId = req.body?.room_id ?? r.room_id;
    if (!roomId) return res.status(400).json({ error: "Assign a room before check-in" });

    const clash = db.prepare(`
      SELECT COUNT(*) AS n FROM reservations
      WHERE room_id = ? AND id != ? AND ${OVERLAP_SQL}`)
      .get(roomId, r.id, r.check_out, r.check_in).n;
    if (clash > 0) return res.status(409).json({ error: "That room is taken for these dates" });

    const tx = db.transaction(() => {
      db.prepare("UPDATE reservations SET status='checked_in', room_id=? WHERE id=?")
        .run(roomId, r.id);
      db.prepare("UPDATE rooms SET status='occupied' WHERE id=?").run(roomId);
    });
    tx();
    res.json({ ok: true });
  });

  app.post("/api/reservations/:id/check-out", requireAuth, (req, res) => {
    const r = getReservation(req.params.id);
    if (!r) return res.status(404).json({ error: "Reservation not found" });
    if (r.status !== "checked_in") {
      return res.status(400).json({ error: "Only checked-in reservations can be checked out" });
    }
    const tx = db.transaction(() => {
      db.prepare("UPDATE reservations SET status='checked_out' WHERE id=?").run(r.id);
      if (r.room_id) {
        db.prepare("UPDATE rooms SET status='available', housekeeping='dirty' WHERE id=?")
          .run(r.room_id);
      }
    });
    tx();
    res.json({ ok: true });
  });

  app.post("/api/reservations/:id/cancel", requireAuth, (req, res) => {
    const r = getReservation(req.params.id);
    if (!r) return res.status(404).json({ error: "Reservation not found" });
    if (["checked_out", "cancelled"].includes(r.status)) {
      return res.status(400).json({ error: `Reservation is already ${r.status}` });
    }
    const tx = db.transaction(() => {
      db.prepare("UPDATE reservations SET status='cancelled' WHERE id=?").run(r.id);
      if (r.status === "checked_in" && r.room_id) {
        db.prepare("UPDATE rooms SET status='available', housekeeping='dirty' WHERE id=?")
          .run(r.room_id);
      }
    });
    tx();
    res.json({ ok: true });
  });

  // ---------------- payments ----------------
  app.get("/api/reservations/:id/payments", requireAuth, (req, res) => {
    const payments = db.prepare(
      "SELECT * FROM payments WHERE reservation_id = ? ORDER BY paid_at"
    ).all(req.params.id);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const r = getReservation(req.params.id);
    res.json({ payments, paid, total: r ? r.total : 0, balance: r ? r.total - paid : 0 });
  });

  app.post("/api/reservations/:id/payments", requireAuth, (req, res) => {
    const r = getReservation(req.params.id);
    if (!r) return res.status(404).json({ error: "Reservation not found" });
    const { amount, method = "cash", reference = "" } = req.body || {};
    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than zero" });
    const id = db.prepare(`
      INSERT INTO payments (reservation_id, amount, method, reference)
      VALUES (?, ?, ?, ?)`)
      .run(r.id, amount, method, reference).lastInsertRowid;
    res.status(201).json({ id });
  });

  // ---------------- dashboard ----------------
  app.get("/api/properties/:id/dashboard", requireAuth, (req, res) => {
    const pid = req.params.id;
    const today = req.query.date && isDate(req.query.date)
      ? req.query.date
      : new Date().toISOString().slice(0, 10);

    const totalRooms = db.prepare(
      "SELECT COUNT(*) AS n FROM rooms WHERE property_id = ? AND status != 'out_of_service'"
    ).get(pid).n;
    const occupied = db.prepare(
      "SELECT COUNT(*) AS n FROM rooms WHERE property_id = ? AND status = 'occupied'"
    ).get(pid).n;

    const arrivals = db.prepare(`
      SELECT res.id, res.code, g.full_name AS guest_name, t.name AS room_type_name,
             r.number AS room_number, res.status
      FROM reservations res
      JOIN guests g ON g.id = res.guest_id
      JOIN room_types t ON t.id = res.room_type_id
      LEFT JOIN rooms r ON r.id = res.room_id
      WHERE res.property_id = ? AND res.check_in = ? AND res.status IN ('booked','checked_in')
      ORDER BY g.full_name`).all(pid, today);

    const departures = db.prepare(`
      SELECT res.id, res.code, g.full_name AS guest_name, t.name AS room_type_name,
             r.number AS room_number, res.status
      FROM reservations res
      JOIN guests g ON g.id = res.guest_id
      JOIN room_types t ON t.id = res.room_type_id
      LEFT JOIN rooms r ON r.id = res.room_id
      WHERE res.property_id = ? AND res.check_out = ? AND res.status IN ('checked_in','checked_out')
      ORDER BY g.full_name`).all(pid, today);

    const dirty = db.prepare(
      "SELECT COUNT(*) AS n FROM rooms WHERE property_id = ? AND housekeeping = 'dirty'"
    ).get(pid).n;

    res.json({
      date: today,
      rooms: { total: totalRooms, occupied, available: totalRooms - occupied },
      occupancy_pct: totalRooms ? Math.round((occupied / totalRooms) * 100) : 0,
      arrivals,
      departures,
      housekeeping_dirty: dirty,
    });
  });
}

module.exports = { registerReservationRoutes };
