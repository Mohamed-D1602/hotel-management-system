// Smoke test: exercises the full reservation lifecycle against a running server.
// Usage: node test/smoke.js  (server must be running on :3000)
const BASE = "http://localhost:3000";
let token = null;

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

function assert(cond, label) {
  if (!cond) { console.error("FAIL:", label); process.exit(1); }
  console.log("ok  :", label);
}

(async () => {
  // login
  let r = await api("/api/auth/login", { method: "POST",
    body: { email: "admin@kanon.example", password: "admin123" } });
  assert(r.status === 200 && r.data.token, "login");
  token = r.data.token;

  // properties
  r = await api("/api/properties");
  assert(r.data.length >= 2, "two seeded properties");
  const khartoum = r.data.find((p) => p.city === "Khartoum");
  assert(khartoum && khartoum.currency === "SDG", "Khartoum property with SDG");

  // guest
  r = await api("/api/guests", { method: "POST",
    body: { full_name: "Smoke Test Guest", phone: "+249 900 000 000" } });
  assert(r.status === 201, "create guest");
  const guestId = r.data.id;

  // room types + availability
  const types = (await api(`/api/properties/${khartoum.id}/room-types`)).data;
  assert(types.length === 6, "six Khartoum room categories");
  r = await api(`/api/properties/${khartoum.id}/availability?check_in=2030-01-10&check_out=2030-01-12`);
  assert(r.data.nights === 2 && r.data.rooms.length > 0, "availability search");
  const room = r.data.rooms[0];

  // reservation
  r = await api(`/api/properties/${khartoum.id}/reservations`, { method: "POST",
    body: { guest_id: guestId, room_type_id: room.room_type_id, room_id: room.id,
            check_in: "2030-01-10", check_out: "2030-01-12", nightly_rate: 100 } });
  assert(r.status === 201 && r.data.total === 200, "create reservation (2 nights x 100)");
  const resId = r.data.id;

  // double-booking guard
  r = await api(`/api/properties/${khartoum.id}/reservations`, { method: "POST",
    body: { guest_id: guestId, room_type_id: room.room_type_id, room_id: room.id,
            check_in: "2030-01-11", check_out: "2030-01-13" } });
  assert(r.status === 409, "double-booking is rejected");

  // check-in
  r = await api(`/api/reservations/${resId}/check-in`, { method: "POST", body: {} });
  assert(r.status === 200, "check-in");
  const roomAfter = (await api(`/api/properties/${khartoum.id}/rooms`)).data
    .find((x) => x.id === room.id);
  assert(roomAfter.status === "occupied", "room becomes occupied");

  // payment
  r = await api(`/api/reservations/${resId}/payments`, { method: "POST",
    body: { amount: 150, method: "cash" } });
  assert(r.status === 201, "record payment");
  r = await api(`/api/reservations/${resId}/payments`);
  assert(r.data.balance === 50, "balance = 50");

  // check-out
  r = await api(`/api/reservations/${resId}/check-out`, { method: "POST" });
  assert(r.status === 200, "check-out");
  const roomFinal = (await api(`/api/properties/${khartoum.id}/rooms`)).data
    .find((x) => x.id === room.id);
  assert(roomFinal.status === "available" && roomFinal.housekeeping === "dirty",
    "room available + marked dirty after check-out");

  // dashboard
  r = await api(`/api/properties/${khartoum.id}/dashboard?date=2030-01-10`);
  assert(r.status === 200 && typeof r.data.occupancy_pct === "number", "dashboard");

  // ---------- public booking site API (no auth) ----------
  const pub = (path, options = {}) =>
    fetch(BASE + path, {
      ...options,
      headers: { "Content-Type": "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(async (x) => ({ status: x.status, data: await x.json() }));

  r = await pub("/api/public/properties");
  assert(r.status === 200 && r.data.length >= 2, "public: hotels list (no login)");
  const makkah = r.data.find((p) => p.city === "Makkah");
  assert(makkah, "public: Makkah property present");

  r = await pub(`/api/public/properties/${khartoum.id}/availability?check_in=2030-02-01&check_out=2030-02-03`);
  assert(r.status === 200 && r.data.room_types.length === 6, "public: availability by room type");
  const bookable = r.data.room_types.find((t) => t.available > 0);
  assert(bookable, "public: at least one bookable type");

  r = await pub("/api/public/bookings", { method: "POST",
    body: { property_id: khartoum.id, room_type_id: bookable.id,
            check_in: "2030-02-01", check_out: "2030-02-03",
            full_name: "Online Guest", phone: "+249 912 000 000" } });
  assert(r.status === 201 && r.data.code, "public: online booking created, code " + r.data.code);

  // booking must appear in the front-desk system
  r = await api(`/api/properties/${khartoum.id}/reservations?status=booked`);
  assert(r.data.some((x) => x.guest_name === "Online Guest"),
    "online booking visible to front desk");

  // guest with no contact details is rejected
  r = await pub("/api/public/bookings", { method: "POST",
    body: { property_id: khartoum.id, room_type_id: bookable.id,
            check_in: "2030-02-01", check_out: "2030-02-03", full_name: "No Contact" } });
  assert(r.status === 400, "public: booking without phone/email rejected");

  console.log("\nAll smoke tests passed.");
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
