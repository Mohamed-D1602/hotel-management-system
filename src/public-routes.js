// Public (no-login) API for the guest booking website.
// Guests can browse hotels, check availability, and create a booking.
// Bookings arrive in the front-desk system with status 'booked'.

const { db, reservationCode, logActivity } = require("./db");

function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function nightsBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}

const OVERLAP_SQL = `
  status IN ('booked','checked_in')
  AND check_in < ? AND check_out > ?
`;

// How many rooms of a type are free for a date range.
// Counts physical rooms not blocked by room-assigned reservations, then
// subtracts unassigned reservations of the same type overlapping the range.
function availableCount(propertyId, roomTypeId, checkIn, checkOut) {
  const freeRooms = db.prepare(`
    SELECT COUNT(*) AS n FROM rooms r
    WHERE r.property_id = ? AND r.room_type_id = ? AND r.status != 'out_of_service'
      AND r.id NOT IN (
        SELECT room_id FROM reservations
        WHERE room_id IS NOT NULL AND ${OVERLAP_SQL}
      )`).get(propertyId, roomTypeId, checkOut, checkIn).n;

  const unassigned = db.prepare(`
    SELECT COUNT(*) AS n FROM reservations
    WHERE property_id = ? AND room_type_id = ? AND room_id IS NULL AND ${OVERLAP_SQL}`)
    .get(propertyId, roomTypeId, checkOut, checkIn).n;

  return Math.max(0, freeRooms - unassigned);
}

function registerPublicRoutes(app) {
  app.get("/api/public/properties", (req, res) => {
    res.json(db.prepare(`
      SELECT p.id, p.name, p.city, p.country, p.address, p.phone, p.currency,
             b.name AS brand_name
      FROM properties p JOIN brands b ON b.id = p.brand_id
      WHERE p.active = 1 ORDER BY p.name`).all());
  });

  app.get("/api/public/properties/:id/room-types", (req, res) => {
    res.json(db.prepare(`
      SELECT id, name, description, capacity, base_rate
      FROM room_types WHERE property_id = ? ORDER BY base_rate, name`)
      .all(req.params.id));
  });

  app.get("/api/public/properties/:id/availability", (req, res) => {
    const { check_in, check_out } = req.query;
    if (!isDate(check_in) || !isDate(check_out) || check_out <= check_in) {
      return res.status(400).json({ error: "Choose a check-out date after your check-in date" });
    }
    const types = db.prepare(`
      SELECT id, name, description, capacity, base_rate
      FROM room_types WHERE property_id = ? ORDER BY base_rate, name`)
      .all(req.params.id);

    const nights = nightsBetween(check_in, check_out);
    res.json({
      nights,
      room_types: types.map((t) => ({
        ...t,
        available: availableCount(Number(req.params.id), t.id, check_in, check_out),
        total: t.base_rate * nights,
      })),
    });
  });

  app.post("/api/public/bookings", (req, res) => {
    const { property_id, room_type_id, check_in, check_out,
            full_name, phone = "", email = "",
            adults = 1, children = 0, notes = "" } = req.body || {};

    if (!property_id || !room_type_id) {
      return res.status(400).json({ error: "Choose a hotel and a room type" });
    }
    if (!isDate(check_in) || !isDate(check_out) || check_out <= check_in) {
      return res.status(400).json({ error: "Choose a check-out date after your check-in date" });
    }
    if (!full_name || !String(full_name).trim()) {
      return res.status(400).json({ error: "Please enter your full name" });
    }
    if (!String(phone).trim() && !String(email).trim()) {
      return res.status(400).json({ error: "Please give a phone number or an email so the hotel can reach you" });
    }

    const type = db.prepare(
      "SELECT * FROM room_types WHERE id = ? AND property_id = ?"
    ).get(room_type_id, property_id);
    if (!type) return res.status(400).json({ error: "Room type not found for this hotel" });

    if (availableCount(Number(property_id), type.id, check_in, check_out) < 1) {
      return res.status(409).json({ error: "Sorry — no rooms of this type are left for those dates. Please try different dates or another room type." });
    }

    const nights = nightsBetween(check_in, check_out);
    const tx = db.transaction(() => {
      const guestId = db.prepare(`
        INSERT INTO guests (full_name, email, phone, notes)
        VALUES (?, ?, ?, 'Online booking')`)
        .run(String(full_name).trim(), String(email).trim(), String(phone).trim())
        .lastInsertRowid;

      const code = reservationCode();
      db.prepare(`
        INSERT INTO reservations
          (code, property_id, room_id, room_type_id, guest_id, check_in, check_out,
           adults, children, nightly_rate, total, notes)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(code, property_id, type.id, guestId, check_in, check_out,
             Number(adults) || 1, Number(children) || 0,
             type.base_rate, type.base_rate * nights,
             String(notes).slice(0, 500));
      return code;
    });

    const code = tx();
    logActivity(Number(property_id), "Online guest", "online_booking",
      `${String(full_name).trim()} · ${check_in} → ${check_out} · ${type.name} · ${code}`);
    res.status(201).json({
      code, nights,
      nightly_rate: type.base_rate,
      total: type.base_rate * nights,
    });
  });
}

module.exports = { registerPublicRoutes };
