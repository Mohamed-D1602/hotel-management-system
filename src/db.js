// Database layer — SQLite via better-sqlite3.
// Generic multi-brand, multi-property schema. Any hotel brand can be added;
// Kanon Hotels (Khartoum + Makkah) is seeded as the first brand.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "hms.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------- schema
db.exec(`
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS room_types (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  description TEXT,
  capacity INTEGER NOT NULL DEFAULT 2,
  base_rate REAL NOT NULL DEFAULT 0,
  UNIQUE(property_id, name)
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  number TEXT NOT NULL,
  floor INTEGER,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','occupied','out_of_service')),
  housekeeping TEXT NOT NULL DEFAULT 'clean'
    CHECK (housekeeping IN ('clean','dirty','inspected')),
  UNIQUE(property_id, number)
);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  nationality TEXT,
  id_document TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  room_id INTEGER REFERENCES rooms(id),
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  guest_id INTEGER NOT NULL REFERENCES guests(id),
  check_in TEXT NOT NULL,   -- YYYY-MM-DD
  check_out TEXT NOT NULL,  -- YYYY-MM-DD
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  nightly_rate REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked','checked_in','checked_out','cancelled','no_show')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash','card','bank_transfer','mobile_money','other')),
  reference TEXT,
  paid_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','manager','staff')),
  property_id INTEGER REFERENCES properties(id)  -- NULL = all properties
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_res_property_dates
  ON reservations(property_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_rooms_property ON rooms(property_id);
`);

// ---------------------------------------------------------------- helpers
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function reservationCode() {
  return "R" + Date.now().toString(36).toUpperCase() +
    crypto.randomBytes(2).toString("hex").toUpperCase();
}

// ---------------------------------------------------------------- seed
function seed() {
  const hasBrand = db.prepare("SELECT COUNT(*) AS n FROM brands").get().n;
  if (hasBrand > 0) return;

  const seedTx = db.transaction(() => {
    const brandId = db
      .prepare("INSERT INTO brands (name, slug) VALUES (?, ?)")
      .run("Kanon Hotels", "kanon-hotels").lastInsertRowid;

    const insertProperty = db.prepare(`
      INSERT INTO properties (brand_id, name, city, country, address, phone, currency, timezone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    const khartoumId = insertProperty.run(
      brandId, "Kanon Hotel Khartoum", "Khartoum", "Sudan",
      "Street 15, Al-Amarat, P.O. Box 2425", "", "SDG", "Africa/Khartoum"
    ).lastInsertRowid;

    const makkahId = insertProperty.run(
      brandId, "Kanon Hotel Makkah", "Makkah", "Saudi Arabia",
      "", "", "SAR", "Asia/Riyadh"
    ).lastInsertRowid;

    // Sample room types — replace names and rates with the real Kanon rate card.
    const insertType = db.prepare(`
      INSERT INTO room_types (property_id, name, description, capacity, base_rate)
      VALUES (?, ?, ?, ?, ?)`);

    const khartoumTypes = [
      ["Standard Single", "En-suite single room", 1, 0],
      ["Standard Double", "En-suite double room", 2, 0],
      ["Twin Room", "Two single beds, en-suite", 2, 0],
      ["Junior Suite", "Sitting area and en-suite bathroom", 2, 0],
      ["Executive Suite", "Separate lounge, en-suite", 3, 0],
      ["Royal Suite", "Premier suite", 4, 0],
    ];
    const typeIds = khartoumTypes.map(t => insertType.run(khartoumId, ...t).lastInsertRowid);

    insertType.run(makkahId, "Standard Room", "En-suite room", 2, 0);
    insertType.run(makkahId, "Suite", "Suite with lounge", 3, 0);

    // Sample rooms for Khartoum (a starter block per floor; the hotel has 124
    // en-suite rooms — add the rest from the Rooms screen or the API).
    const insertRoom = db.prepare(`
      INSERT INTO rooms (property_id, room_type_id, number, floor)
      VALUES (?, ?, ?, ?)`);
    let n = 0;
    for (let floor = 1; floor <= 4; floor++) {
      for (let i = 1; i <= 6; i++) {
        const typeId = typeIds[n % typeIds.length];
        insertRoom.run(khartoumId, typeId, `${floor}${String(i).padStart(2, "0")}`, floor);
        n++;
      }
    }

    // Default admin — change this password immediately after first login.
    db.prepare(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (?, ?, ?, 'admin')`)
      .run("Administrator", "admin@kanon.example", hashPassword("admin123"));
  });

  seedTx();
  console.log("Seeded: Kanon Hotels brand, Khartoum + Makkah properties, default admin.");
}

seed();

// One-time migration: earlier versions seeded the Saudi property as Jeddah.
db.prepare(`
  UPDATE properties SET name = 'Kanon Hotel Makkah', city = 'Makkah'
  WHERE name = 'Kanon Hotel Jeddah'`).run();

module.exports = { db, hashPassword, verifyPassword, reservationCode };
