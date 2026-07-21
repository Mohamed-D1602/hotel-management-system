/* HMS Front Desk — single-page app (no build step). */
"use strict";

// ---------------------------------------------------------------- state
const state = {
  token: localStorage.getItem("hms_token") || null,
  user: null,
  properties: [],
  propertyId: Number(localStorage.getItem("hms_property")) || null,
  page: "dashboard",
};

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function currentProperty() {
  return state.properties.find((p) => p.id === state.propertyId);
}
function money(v) {
  const cur = currentProperty()?.currency || "";
  return `${Number(v).toLocaleString()} ${cur}`.trim();
}

// ---------------------------------------------------------------- api
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { signOutLocal(); throw new Error(data.error || "Signed out"); }
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(message, isError = false) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.toggle("error", isError);
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3200);
}

// ---------------------------------------------------------------- modal
function openModal(title, bodyHTML, onSubmit, submitLabel = "Save") {
  const root = $("#modal-root");
  root.innerHTML = "";
  const backdrop = el(`
    <div class="modal-backdrop">
      <form class="modal">
        <h3>${esc(title)}</h3>
        <div class="modal-body">${bodyHTML}</div>
        <div class="modal-actions">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
        </div>
      </form>
    </div>`);
  root.appendChild(backdrop);
  const close = () => (root.innerHTML = "");
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  $("[data-close]", backdrop).addEventListener("click", close);
  $("form", backdrop).addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await onSubmit(new FormData(e.target), close); }
    catch (err) { toast(err.message, true); }
  });
  return backdrop;
}

// ---------------------------------------------------------------- auth
function signOutLocal() {
  state.token = null; state.user = null;
  localStorage.removeItem("hms_token");
  showLogin();
}

function showLogin() {
  $("#app-view").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
}

async function boot() {
  if (!state.token) return showLogin();
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
    await enterApp();
  } catch { showLogin(); }
}

async function enterApp() {
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#user-name").textContent = `${state.user.name} · ${state.user.role}`;
  state.properties = await api("/api/properties");
  if (!state.propertyId || !currentProperty()) {
    state.propertyId = state.properties[0]?.id || null;
  }
  renderPropertySwitcher();
  navigate(state.page);
}

function renderPropertySwitcher() {
  const sel = $("#property-switcher");
  sel.innerHTML = state.properties
    .map((p) => `<option value="${p.id}" ${p.id === state.propertyId ? "selected" : ""}>${esc(p.name)}</option>`)
    .join("");
}

// ---------------------------------------------------------------- routing
function navigate(page) {
  state.page = page;
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.page === page));
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  $(`#page-${page}`).classList.remove("hidden");
  const renderers = {
    dashboard: renderDashboard,
    reservations: renderReservations,
    rooms: renderRooms,
    guests: renderGuests,
    housekeeping: renderHousekeeping,
    accounts: renderAccounts,
    activity: renderActivity,
    "room-types": renderRoomTypes,
    properties: renderProperties,
    settings: renderSettings,
  };
  renderers[page]?.().catch((e) => toast(e.message, true));
}

// ---------------------------------------------------------------- dashboard
async function renderDashboard() {
  const root = $("#page-dashboard");
  const p = currentProperty();
  if (!p) { root.innerHTML = `<p class="empty">Add a property to get started.</p>`; return; }
  const d = await api(`/api/properties/${p.id}/dashboard`);

  const listRows = (items, emptyText) => items.length
    ? items.map((a) => `
        <tr>
          <td>${esc(a.guest_name)}</td>
          <td>${esc(a.room_type_name)}</td>
          <td>${esc(a.room_number || "—")}</td>
          <td><span class="badge badge-${a.status}">${esc(a.status.replace("_", " "))}</span></td>
        </tr>`).join("")
    : `<tr><td colspan="4" class="empty">${emptyText}</td></tr>`;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>${esc(p.name)}</h2>
        <p class="page-sub">${esc(p.city)}, ${esc(p.country)} · ${esc(d.date)}</p>
      </div>
      <button class="btn btn-primary" id="dash-new-res">New reservation</button>
    </div>
    <div class="cards">
      <div class="stat-card accent"><div class="stat-label">Occupancy</div><div class="stat-value">${d.occupancy_pct}%</div></div>
      <div class="stat-card"><div class="stat-label">Rooms occupied</div><div class="stat-value">${d.rooms.occupied} / ${d.rooms.total}</div></div>
      <div class="stat-card"><div class="stat-label">Arrivals today</div><div class="stat-value">${d.arrivals.length}</div></div>
      <div class="stat-card"><div class="stat-label">Departures today</div><div class="stat-value">${d.departures.length}</div></div>
      <div class="stat-card"><div class="stat-label">Rooms to clean</div><div class="stat-value">${d.housekeeping_dirty}</div></div>
    </div>
    <div class="panel">
      <h3>Arrivals — ${esc(d.date)}</h3>
      <table><thead><tr><th>Guest</th><th>Room type</th><th>Room</th><th>Status</th></tr></thead>
      <tbody>${listRows(d.arrivals, "No arrivals today")}</tbody></table>
    </div>
    <div class="panel">
      <h3>Departures — ${esc(d.date)}</h3>
      <table><thead><tr><th>Guest</th><th>Room type</th><th>Room</th><th>Status</th></tr></thead>
      <tbody>${listRows(d.departures, "No departures today")}</tbody></table>
    </div>`;
  $("#dash-new-res").addEventListener("click", () => newReservationModal());
}

// ---------------------------------------------------------------- reservations
async function renderReservations() {
  const root = $("#page-reservations");
  const p = currentProperty();
  if (!p) { root.innerHTML = ""; return; }
  const status = root.dataset.filter || "";
  const list = await api(`/api/properties/${p.id}/reservations${status ? `?status=${status}` : ""}`);

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Reservations</h2><p class="page-sub">${esc(p.name)}</p></div>
      <button class="btn btn-primary" id="res-new">New reservation</button>
    </div>
    <div class="toolbar">
      <label>Status
        <select id="res-filter">
          <option value="">All</option>
          ${["booked", "checked_in", "checked_out", "cancelled"].map((s) =>
            `<option value="${s}" ${s === status ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>Code</th><th>Guest</th><th>Room</th><th>Dates</th><th>Total</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${list.length ? list.map((r) => `
            <tr>
              <td>${esc(r.code)}</td>
              <td>${esc(r.guest_name)}<br><small>${esc(r.guest_phone || "")}</small></td>
              <td>${esc(r.room_number || "—")}<br><small>${esc(r.room_type_name)}</small></td>
              <td>${esc(r.check_in)} → ${esc(r.check_out)}</td>
              <td>${money(r.total)}</td>
              <td><span class="badge badge-${r.status}">${esc(r.status.replace("_", " "))}</span></td>
              <td class="row-actions">
                ${r.status === "booked" ? `<button class="btn btn-small btn-primary" data-act="check-in" data-id="${r.id}">Check in</button>
                  <button class="btn btn-small btn-danger" data-act="cancel" data-id="${r.id}">Cancel</button>` : ""}
                ${r.status === "checked_in" ? `<button class="btn btn-small btn-primary" data-act="check-out" data-id="${r.id}">Check out</button>` : ""}
                ${["booked", "checked_in"].includes(r.status) ? `<button class="btn btn-small" data-act="edit" data-id="${r.id}">Edit</button>` : ""}
                ${r.status === "booked" ? `<button class="btn btn-small" data-act="no-show" data-id="${r.id}">No-show</button>` : ""}
                <button class="btn btn-small" data-act="payments" data-id="${r.id}">Payments</button>
                <button class="btn btn-small" data-act="invoice" data-id="${r.id}">Invoice</button>
              </td>
            </tr>`).join("")
          : `<tr><td colspan="7" class="empty">No reservations yet — create the first one.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  $("#res-new").addEventListener("click", () => newReservationModal());
  $("#res-filter").addEventListener("change", (e) => {
    root.dataset.filter = e.target.value;
    renderReservations();
  });
  root.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => reservationAction(btn.dataset.act, Number(btn.dataset.id), list)));
}

async function reservationAction(act, id, list) {
  const r = list.find((x) => x.id === id);
  try {
    if (act === "check-in") {
      if (r.room_id) {
        await api(`/api/reservations/${id}/check-in`, { method: "POST", body: {} });
        toast(`Checked in ${r.guest_name}`);
      } else {
        return assignRoomAndCheckIn(r);
      }
    } else if (act === "check-out") {
      await api(`/api/reservations/${id}/check-out`, { method: "POST" });
      toast(`Checked out ${r.guest_name} — room marked for housekeeping`);
    } else if (act === "cancel") {
      await api(`/api/reservations/${id}/cancel`, { method: "POST" });
      toast("Reservation cancelled");
    } else if (act === "no-show") {
      await api(`/api/reservations/${id}/no-show`, { method: "POST" });
      toast("Marked as no-show");
    } else if (act === "edit") {
      return editReservationModal(r);
    } else if (act === "invoice") {
      return printInvoice(id);
    } else if (act === "payments") {
      return paymentsModal(r);
    }
    renderReservations();
  } catch (e) { toast(e.message, true); }
}

async function assignRoomAndCheckIn(r) {
  const p = currentProperty();
  const { rooms } = await api(
    `/api/properties/${p.id}/availability?check_in=${r.check_in}&check_out=${r.check_out}`);
  const options = rooms.filter((x) => x.room_type_id === r.room_type_id);
  const pool = options.length ? options : rooms;
  if (!pool.length) return toast("No rooms free for these dates", true);

  openModal(`Assign a room — ${r.guest_name}`, `
    <label>Room
      <select name="room_id" required>
        ${pool.map((x) => `<option value="${x.id}">Room ${esc(x.number)} — ${esc(x.room_type_name)}</option>`).join("")}
      </select>
    </label>`,
    async (fd, close) => {
      await api(`/api/reservations/${r.id}/check-in`, {
        method: "POST", body: { room_id: Number(fd.get("room_id")) } });
      close(); toast(`Checked in ${r.guest_name}`); renderReservations();
    }, "Check in");
}

async function paymentsModal(r) {
  const data = await api(`/api/reservations/${r.id}/payments`);
  openModal(`Payments — ${r.code}`, `
    <p style="margin-top:0">Total ${money(data.total)} · Paid ${money(data.paid)} ·
      <strong>Balance ${money(data.balance)}</strong></p>
    ${data.payments.length ? `<table style="margin-bottom:14px">
      <thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead>
      <tbody>${data.payments.map((p) => `
        <tr><td>${esc(p.paid_at.slice(0, 10))}</td><td>${money(p.amount)}</td><td>${esc(p.method.replace("_", " "))}</td></tr>`).join("")}
      </tbody></table>` : `<p class="empty">No payments recorded yet.</p>`}
    <div class="grid-2">
      <label>Amount<input type="number" name="amount" min="0" step="0.01" required></label>
      <label>Method
        <select name="method">
          <option value="cash">Cash</option><option value="card">Card</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="mobile_money">Mobile money</option><option value="other">Other</option>
        </select>
      </label>
    </div>
    <label>Reference<input name="reference" placeholder="Receipt or transfer reference"></label>`,
    async (fd, close) => {
      await api(`/api/reservations/${r.id}/payments`, {
        method: "POST",
        body: { amount: Number(fd.get("amount")), method: fd.get("method"), reference: fd.get("reference") },
      });
      close(); toast("Payment recorded");
    }, "Record payment");
}

async function newReservationModal() {
  const p = currentProperty();
  const [types, guests] = await Promise.all([
    api(`/api/properties/${p.id}/room-types`),
    api(`/api/guests`),
  ]);
  if (!types.length) return toast("Add room types for this property first", true);

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  openModal("New reservation", `
    <label>Guest
      <select name="guest_id" required>
        <option value="">Select a guest…</option>
        ${guests.map((g) => `<option value="${g.id}">${esc(g.full_name)}${g.phone ? " · " + esc(g.phone) : ""}</option>`).join("")}
        <option value="__new__">＋ New guest</option>
      </select>
    </label>
    <div id="new-guest-fields" class="hidden">
      <div class="grid-2">
        <label>Full name<input name="new_guest_name"></label>
        <label>Phone<input name="new_guest_phone"></label>
      </div>
    </div>
    <div class="grid-2">
      <label>Check-in<input type="date" name="check_in" value="${today}" required></label>
      <label>Check-out<input type="date" name="check_out" value="${tomorrow}" required></label>
    </div>
    <div class="grid-2">
      <label>Room type
        <select name="room_type_id" required>
          ${types.map((t) => `<option value="${t.id}" data-rate="${t.base_rate}">${esc(t.name)} — ${t.base_rate ? money(t.base_rate) + "/night" : "rate not set"}</option>`).join("")}
        </select>
      </label>
      <label>Nightly rate<input type="number" name="nightly_rate" min="0" step="0.01" value="${types[0].base_rate}"></label>
    </div>
    <div class="grid-2">
      <label>Adults<input type="number" name="adults" min="1" value="1"></label>
      <label>Children<input type="number" name="children" min="0" value="0"></label>
    </div>
    <label>Notes<textarea name="notes" rows="2"></textarea></label>`,
    async (fd, close) => {
      let guestId = fd.get("guest_id");
      if (guestId === "__new__") {
        const name = (fd.get("new_guest_name") || "").trim();
        if (!name) throw new Error("Enter the new guest's name");
        const created = await api("/api/guests", {
          method: "POST", body: { full_name: name, phone: fd.get("new_guest_phone") } });
        guestId = created.id;
      }
      if (!guestId) throw new Error("Select a guest");
      const out = await api(`/api/properties/${p.id}/reservations`, {
        method: "POST",
        body: {
          guest_id: Number(guestId),
          room_type_id: Number(fd.get("room_type_id")),
          check_in: fd.get("check_in"),
          check_out: fd.get("check_out"),
          adults: Number(fd.get("adults")),
          children: Number(fd.get("children")),
          nightly_rate: Number(fd.get("nightly_rate")),
          notes: fd.get("notes"),
        },
      });
      close();
      toast(`Reservation created — ${out.nights} night(s), total ${money(out.total)}`);
      if (state.page === "reservations") renderReservations(); else renderDashboard();
    }, "Create reservation");

  // toggle new-guest fields; sync rate with room type
  const modal = $("#modal-root");
  $('[name="guest_id"]', modal).addEventListener("change", (e) => {
    $("#new-guest-fields", modal).classList.toggle("hidden", e.target.value !== "__new__");
  });
  $('[name="room_type_id"]', modal).addEventListener("change", (e) => {
    const rate = e.target.selectedOptions[0]?.dataset.rate || 0;
    $('[name="nightly_rate"]', modal).value = rate;
  });
}

// ---------------------------------------------------------------- rooms
async function renderRooms() {
  const root = $("#page-rooms");
  const p = currentProperty();
  if (!p) { root.innerHTML = ""; return; }
  const [rooms, types] = await Promise.all([
    api(`/api/properties/${p.id}/rooms`),
    api(`/api/properties/${p.id}/room-types`),
  ]);

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Rooms</h2><p class="page-sub">${esc(p.name)} · ${rooms.length} rooms</p></div>
      <button class="btn btn-primary" id="room-new">Add room</button>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>Room</th><th>Floor</th><th>Type</th><th>Status</th><th>Housekeeping</th><th></th></tr></thead>
        <tbody>
          ${rooms.length ? rooms.map((r) => `
            <tr>
              <td><strong>${esc(r.number)}</strong></td>
              <td>${r.floor ?? "—"}</td>
              <td>${esc(r.room_type_name)}</td>
              <td><span class="badge badge-${r.status}">${esc(r.status.replace(/_/g, " "))}</span></td>
              <td><span class="badge badge-${r.housekeeping}">${esc(r.housekeeping)}</span></td>
              <td class="row-actions">
                ${r.housekeeping !== "clean" ? `<button class="btn btn-small" data-clean="${r.id}">Mark clean</button>` : ""}
                <button class="btn btn-small" data-edit="${r.id}">Edit</button>
              </td>
            </tr>`).join("")
          : `<tr><td colspan="6" class="empty">No rooms yet — add the first one.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  const roomForm = (r = {}) => `
    <div class="grid-2">
      <label>Room number<input name="number" value="${esc(r.number || "")}" required></label>
      <label>Floor<input type="number" name="floor" value="${r.floor ?? ""}"></label>
    </div>
    <label>Room type
      <select name="room_type_id" required>
        ${types.map((t) => `<option value="${t.id}" ${t.id === r.room_type_id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
      </select>
    </label>
    ${r.id ? `
    <div class="grid-2">
      <label>Status
        <select name="status">
          ${["available", "occupied", "out_of_service"].map((s) =>
            `<option value="${s}" ${s === r.status ? "selected" : ""}>${s.replace(/_/g, " ")}</option>`).join("")}
        </select>
      </label>
      <label>Housekeeping
        <select name="housekeeping">
          ${["clean", "dirty", "inspected"].map((s) =>
            `<option value="${s}" ${s === r.housekeeping ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </label>
    </div>` : ""}`;

  $("#room-new").addEventListener("click", () => {
    if (!types.length) return toast("Add a room type first", true);
    openModal("Add room", roomForm(), async (fd, close) => {
      await api(`/api/properties/${p.id}/rooms`, {
        method: "POST",
        body: { number: fd.get("number"), floor: fd.get("floor") ? Number(fd.get("floor")) : null,
                room_type_id: Number(fd.get("room_type_id")) },
      });
      close(); toast("Room added"); renderRooms();
    }, "Add room");
  });

  root.querySelectorAll("[data-clean]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api(`/api/rooms/${b.dataset.clean}`, { method: "PUT", body: { housekeeping: "clean" } });
      toast("Room marked clean"); renderRooms();
    }));

  root.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = rooms.find((x) => x.id === Number(b.dataset.edit));
      openModal(`Edit room ${r.number}`, roomForm(r), async (fd, close) => {
        await api(`/api/rooms/${r.id}`, {
          method: "PUT",
          body: { number: fd.get("number"), floor: fd.get("floor") ? Number(fd.get("floor")) : null,
                  room_type_id: Number(fd.get("room_type_id")),
                  status: fd.get("status"), housekeeping: fd.get("housekeeping") },
        });
        close(); toast("Room updated"); renderRooms();
      });
    }));
}

// ---------------------------------------------------------------- guests
async function renderGuests() {
  const root = $("#page-guests");
  const q = root.dataset.q || "";
  const guests = await api(`/api/guests${q ? `?q=${encodeURIComponent(q)}` : ""}`);

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Guests</h2><p class="page-sub">Shared across all properties</p></div>
      <button class="btn btn-primary" id="guest-new">Add guest</button>
    </div>
    <div class="toolbar">
      <label style="min-width:260px">Search
        <input id="guest-search" placeholder="Name, email or phone" value="${esc(q)}">
      </label>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Nationality</th><th></th></tr></thead>
        <tbody>
          ${guests.length ? guests.map((g) => `
            <tr>
              <td><strong>${esc(g.full_name)}</strong></td>
              <td>${esc(g.phone || "—")}</td>
              <td>${esc(g.email || "—")}</td>
              <td>${esc(g.nationality || "—")}</td>
              <td class="row-actions"><button class="btn btn-small" data-edit="${g.id}">Edit</button></td>
            </tr>`).join("")
          : `<tr><td colspan="5" class="empty">No guests found.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  const guestForm = (g = {}) => `
    <label>Full name<input name="full_name" value="${esc(g.full_name || "")}" required></label>
    <div class="grid-2">
      <label>Phone<input name="phone" value="${esc(g.phone || "")}"></label>
      <label>Email<input type="email" name="email" value="${esc(g.email || "")}"></label>
    </div>
    <div class="grid-2">
      <label>Nationality<input name="nationality" value="${esc(g.nationality || "")}"></label>
      <label>ID / passport<input name="id_document" value="${esc(g.id_document || "")}"></label>
    </div>
    <label>Notes<textarea name="notes" rows="2">${esc(g.notes || "")}</textarea></label>`;

  let searchTimer;
  $("#guest-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { root.dataset.q = e.target.value; renderGuests(); }, 350);
  });

  $("#guest-new").addEventListener("click", () =>
    openModal("Add guest", guestForm(), async (fd, close) => {
      await api("/api/guests", { method: "POST", body: Object.fromEntries(fd) });
      close(); toast("Guest added"); renderGuests();
    }, "Add guest"));

  root.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const g = guests.find((x) => x.id === Number(b.dataset.edit));
      openModal(`Edit — ${g.full_name}`, guestForm(g), async (fd, close) => {
        await api(`/api/guests/${g.id}`, { method: "PUT", body: Object.fromEntries(fd) });
        close(); toast("Guest updated"); renderGuests();
      });
    }));
}

// ---------------------------------------------------------------- room types
async function renderRoomTypes() {
  const root = $("#page-room-types");
  const p = currentProperty();
  if (!p) { root.innerHTML = ""; return; }
  const types = await api(`/api/properties/${p.id}/room-types`);

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Room types &amp; rates</h2><p class="page-sub">${esc(p.name)} · rates in ${esc(p.currency)}</p></div>
      <button class="btn btn-primary" id="type-new">Add room type</button>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>Type</th><th>Description</th><th>Capacity</th><th>Nightly rate</th><th></th></tr></thead>
        <tbody>
          ${types.length ? types.map((t) => `
            <tr>
              <td><strong>${esc(t.name)}</strong></td>
              <td>${esc(t.description || "—")}</td>
              <td>${t.capacity}</td>
              <td>${t.base_rate ? money(t.base_rate) : '<span class="empty">not set</span>'}</td>
              <td class="row-actions"><button class="btn btn-small" data-edit="${t.id}">Edit</button></td>
            </tr>`).join("")
          : `<tr><td colspan="5" class="empty">No room types yet.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  const typeForm = (t = {}) => `
    <label>Name<input name="name" value="${esc(t.name || "")}" required></label>
    <label>Description<input name="description" value="${esc(t.description || "")}"></label>
    <div class="grid-2">
      <label>Capacity<input type="number" name="capacity" min="1" value="${t.capacity ?? 2}"></label>
      <label>Nightly rate (${esc(p.currency)})<input type="number" name="base_rate" min="0" step="0.01" value="${t.base_rate ?? 0}"></label>
    </div>`;

  $("#type-new").addEventListener("click", () =>
    openModal("Add room type", typeForm(), async (fd, close) => {
      await api(`/api/properties/${p.id}/room-types`, {
        method: "POST",
        body: { name: fd.get("name"), description: fd.get("description"),
                capacity: Number(fd.get("capacity")), base_rate: Number(fd.get("base_rate")) },
      });
      close(); toast("Room type added"); renderRoomTypes();
    }, "Add room type"));

  root.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const t = types.find((x) => x.id === Number(b.dataset.edit));
      openModal(`Edit — ${t.name}`, typeForm(t), async (fd, close) => {
        await api(`/api/room-types/${t.id}`, {
          method: "PUT",
          body: { name: fd.get("name"), description: fd.get("description"),
                  capacity: Number(fd.get("capacity")), base_rate: Number(fd.get("base_rate")) },
        });
        close(); toast("Room type updated"); renderRoomTypes();
      });
    }));
}

// ---------------------------------------------------------------- properties
async function renderProperties() {
  const root = $("#page-properties");
  const [properties, brands] = await Promise.all([
    api("/api/properties"), api("/api/brands"),
  ]);
  const isAdmin = state.user.role === "admin";

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Properties</h2><p class="page-sub">All brands and locations</p></div>
      ${isAdmin ? `<div class="row-actions">
        <button class="btn" id="brand-new">Add brand</button>
        <button class="btn btn-primary" id="prop-new">Add property</button>
      </div>` : ""}
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>Property</th><th>Brand</th><th>Location</th><th>Currency</th>${isAdmin ? "<th></th>" : ""}</tr></thead>
        <tbody>
          ${properties.map((p) => `
            <tr>
              <td><strong>${esc(p.name)}</strong><br><small>${esc(p.address || "")}</small></td>
              <td>${esc(p.brand_name)}</td>
              <td>${esc(p.city)}, ${esc(p.country)}</td>
              <td>${esc(p.currency)}</td>
              ${isAdmin ? `<td class="row-actions"><button class="btn btn-small" data-edit="${p.id}">Edit</button></td>` : ""}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  if (!isAdmin) return;

  const propForm = (p = {}) => `
    ${!p.id ? `<label>Brand
      <select name="brand_id" required>
        ${brands.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}
      </select>
    </label>` : ""}
    <label>Property name<input name="name" value="${esc(p.name || "")}" required></label>
    <div class="grid-2">
      <label>City<input name="city" value="${esc(p.city || "")}" required></label>
      <label>Country<input name="country" value="${esc(p.country || "")}" required></label>
    </div>
    <label>Address<input name="address" value="${esc(p.address || "")}"></label>
    <div class="grid-2">
      <label>Phone<input name="phone" value="${esc(p.phone || "")}"></label>
      <label>Currency<input name="currency" value="${esc(p.currency || "USD")}" maxlength="3"></label>
    </div>
    <label>Timezone<input name="timezone" value="${esc(p.timezone || "UTC")}"></label>`;

  $("#brand-new").addEventListener("click", () =>
    openModal("Add brand", `<label>Brand name<input name="name" required placeholder="e.g. Kanon Hotels"></label>`,
      async (fd, close) => {
        await api("/api/brands", { method: "POST", body: { name: fd.get("name") } });
        close(); toast("Brand added"); renderProperties();
      }, "Add brand"));

  $("#prop-new").addEventListener("click", () =>
    openModal("Add property", propForm(), async (fd, close) => {
      await api("/api/properties", {
        method: "POST",
        body: { ...Object.fromEntries(fd), brand_id: Number(fd.get("brand_id")) },
      });
      close(); toast("Property added");
      state.properties = await api("/api/properties");
      renderPropertySwitcher(); renderProperties();
    }, "Add property"));

  root.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = properties.find((x) => x.id === Number(b.dataset.edit));
      openModal(`Edit — ${p.name}`, propForm(p), async (fd, close) => {
        await api(`/api/properties/${p.id}`, { method: "PUT", body: Object.fromEntries(fd) });
        close(); toast("Property updated");
        state.properties = await api("/api/properties");
        renderPropertySwitcher(); renderProperties();
      });
    }));
}

// ---------------------------------------------------------------- wiring
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: { email: $("#login-email").value, password: $("#login-password").value },
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("hms_token", data.token);
    await enterApp();
  } catch (err) {
    $("#login-error").textContent = err.message;
  }
});

$("#logout-btn").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  signOutLocal();
});

document.querySelectorAll(".nav-item").forEach((b) =>
  b.addEventListener("click", () => navigate(b.dataset.page)));

$("#property-switcher").addEventListener("change", (e) => {
  state.propertyId = Number(e.target.value);
  localStorage.setItem("hms_property", state.propertyId);
  navigate(state.page);
});

boot();

// ---------------------------------------------------------------- housekeeping
async function renderHousekeeping() {
  const root = $("#page-housekeeping");
  const p = currentProperty();
  if (!p) { root.innerHTML = ""; return; }
  const rooms = await api(`/api/properties/${p.id}/rooms`);
  const groups = { dirty: [], clean: [], inspected: [] };
  rooms.forEach((r) => groups[r.housekeeping]?.push(r));

  const chip = (r) => `
    <div class="hk-chip hk-${r.housekeeping}">
      <strong>${esc(r.number)}</strong>
      <span>${esc(r.room_type_name)}</span>
      <span class="badge badge-${r.status}">${esc(r.status.replace(/_/g, " "))}</span>
      <div class="row-actions">
        ${r.housekeeping !== "clean" ? `<button class="btn btn-small" data-hk="clean" data-id="${r.id}">Clean</button>` : ""}
        ${r.housekeeping !== "inspected" ? `<button class="btn btn-small" data-hk="inspected" data-id="${r.id}">Inspected</button>` : ""}
        ${r.housekeeping !== "dirty" ? `<button class="btn btn-small" data-hk="dirty" data-id="${r.id}">Dirty</button>` : ""}
      </div>
    </div>`;

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Housekeeping</h2>
      <p class="page-sub">${esc(p.name)} · ${groups.dirty.length} to clean, ${groups.clean.length} clean, ${groups.inspected.length} inspected</p></div>
    </div>
    <div class="panel"><h3>Needs cleaning (${groups.dirty.length})</h3>
      <div class="hk-grid">${groups.dirty.map(chip).join("") || '<p class="empty">Nothing to clean — great work.</p>'}</div></div>
    <div class="panel"><h3>Clean (${groups.clean.length})</h3>
      <div class="hk-grid">${groups.clean.map(chip).join("") || '<p class="empty">None</p>'}</div></div>
    <div class="panel"><h3>Inspected (${groups.inspected.length})</h3>
      <div class="hk-grid">${groups.inspected.map(chip).join("") || '<p class="empty">None</p>'}</div></div>`;

  root.querySelectorAll("[data-hk]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api(`/api/rooms/${b.dataset.id}`, { method: "PUT", body: { housekeeping: b.dataset.hk } });
      renderHousekeeping();
    }));
}

// ---------------------------------------------------------------- accounts
async function renderAccounts() {
  const root = $("#page-accounts");
  const p = currentProperty();
  if (!p) { root.innerHTML = ""; return; }
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const from = root.dataset.from || monthStart;
  const to = root.dataset.to || today;
  const d = await api(`/api/properties/${p.id}/reports/summary?from=${from}&to=${to}`);

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Accounts</h2><p class="page-sub">${esc(p.name)} · ${esc(from)} → ${esc(to)}</p></div>
    </div>
    <div class="toolbar">
      <label>From<input type="date" id="acc-from" value="${esc(from)}"></label>
      <label>To<input type="date" id="acc-to" value="${esc(to)}"></label>
      <button class="btn btn-primary" id="acc-run">Update</button>
    </div>
    <div class="cards">
      <div class="stat-card accent"><div class="stat-label">Collected</div>
        <div class="stat-value">${money(d.collected.amount)}</div>
        <div class="stat-label">${d.collected.count} payment(s)</div></div>
      <div class="stat-card"><div class="stat-label">Booked revenue (stays starting in period)</div>
        <div class="stat-value">${money(d.booked_revenue.amount)}</div>
        <div class="stat-label">${d.booked_revenue.count} reservation(s)</div></div>
      <div class="stat-card"><div class="stat-label">Outstanding balances</div>
        <div class="stat-value">${money(d.outstanding_total)}</div>
        <div class="stat-label">${d.outstanding.length} reservation(s)</div></div>
    </div>
    <div class="panel"><h3>Payments by method</h3>
      <table><thead><tr><th>Method</th><th>Payments</th><th>Amount</th></tr></thead><tbody>
        ${d.by_method.length ? d.by_method.map((m) => `
          <tr><td>${esc(m.method.replace(/_/g, " "))}</td><td>${m.count}</td><td>${money(m.amount)}</td></tr>`).join("")
        : '<tr><td colspan="3" class="empty">No payments in this period.</td></tr>'}
      </tbody></table></div>
    <div class="panel"><h3>Outstanding balances</h3>
      <table><thead><tr><th>Code</th><th>Guest</th><th>Dates</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead><tbody>
        ${d.outstanding.length ? d.outstanding.map((o) => `
          <tr><td>${esc(o.code)}</td><td>${esc(o.guest_name)}</td>
          <td>${esc(o.check_in)} → ${esc(o.check_out)}</td>
          <td><span class="badge badge-${o.status}">${esc(o.status.replace(/_/g, " "))}</span></td>
          <td>${money(o.total)}</td><td>${money(o.paid)}</td><td><strong>${money(o.balance)}</strong></td></tr>`).join("")
        : '<tr><td colspan="7" class="empty">Nothing outstanding — all paid up.</td></tr>'}
      </tbody></table></div>`;

  $("#acc-run").addEventListener("click", () => {
    root.dataset.from = $("#acc-from").value;
    root.dataset.to = $("#acc-to").value;
    renderAccounts();
  });
}

// ---------------------------------------------------------------- activity
async function renderActivity() {
  const root = $("#page-activity");
  const p = currentProperty();
  if (!p) { root.innerHTML = ""; return; }
  const log = await api(`/api/properties/${p.id}/activity`);
  const labels = {
    booking_created: "Booking created", online_booking: "Online booking",
    check_in: "Check-in", check_out: "Check-out",
    cancelled: "Cancelled", payment: "Payment",
  };
  root.innerHTML = `
    <div class="page-head"><div><h2>Activity</h2>
      <p class="page-sub">${esc(p.name)} · everything that happened, newest first</p></div></div>
    <div class="panel">
      <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>
        ${log.length ? log.map((a) => `
          <tr><td>${esc(a.created_at)}</td><td>${esc(a.actor)}</td>
          <td><span class="badge badge-${a.action === "cancelled" ? "cancelled" : a.action === "payment" ? "checked_in" : "booked"}">${esc(labels[a.action] || a.action)}</span></td>
          <td>${esc(a.details || "")}</td></tr>`).join("")
        : '<tr><td colspan="4" class="empty">No activity yet.</td></tr>'}
      </tbody></table></div>`;
}

// ---------------------------------------------------------------- edit reservation
function editReservationModal(r) {
  openModal(`Edit — ${r.code}`, `
    <div class="grid-2">
      <label>Check-in<input type="date" name="check_in" value="${esc(r.check_in)}" required></label>
      <label>Check-out<input type="date" name="check_out" value="${esc(r.check_out)}" required></label>
    </div>
    <div class="grid-2">
      <label>Nightly rate<input type="number" name="nightly_rate" min="0" step="0.01" value="${r.nightly_rate}"></label>
      <label>Adults<input type="number" name="adults" min="1" value="${r.adults}"></label>
    </div>
    <label>Notes<textarea name="notes" rows="2">${esc(r.notes || "")}</textarea></label>`,
    async (fd, close) => {
      const out = await api(`/api/reservations/${r.id}`, {
        method: "PUT",
        body: {
          check_in: fd.get("check_in"), check_out: fd.get("check_out"),
          nightly_rate: Number(fd.get("nightly_rate")),
          adults: Number(fd.get("adults")), notes: fd.get("notes"),
        },
      });
      close(); toast(`Updated — new total ${money(out.total)}`); renderReservations();
    });
}

// ---------------------------------------------------------------- invoice printing
async function printInvoice(id) {
  const f = await api(`/api/reservations/${id}/folio`);
  const rows = f.payments.map((p) => `
    <tr><td>${esc(p.paid_at.slice(0, 10))}</td><td>${esc(p.method.replace("_", " "))}</td>
    <td style="text-align:right">${Number(p.amount).toLocaleString()} ${esc(f.currency)}</td></tr>`).join("");
  const w = window.open("", "_blank");
  w.document.write(`<!DOCTYPE html><html><head><title>Invoice ${esc(f.code)}</title>
  <style>
    body { font-family: Georgia, serif; color: #1c2321; max-width: 700px; margin: 40px auto; padding: 0 20px; }
    .head { display: flex; justify-content: space-between; border-bottom: 3px solid #b98a2f; padding-bottom: 16px; }
    h1 { font-size: 22px; margin: 0; } h2 { font-size: 15px; margin: 24px 0 8px; }
    .muted { color: #666; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    td, th { padding: 8px 6px; border-bottom: 1px solid #ddd; text-align: left; }
    .totals td { font-size: 15px; } .grand { font-weight: bold; font-size: 17px; }
    @media print { .noprint { display: none; } }
  </style></head><body>
  <div class="head">
    <div><h1>${esc(f.property_name)}</h1>
      <div class="muted">${esc(f.property_address || "")}<br>${esc(f.property_phone || "")}</div></div>
    <div style="text-align:right"><h1>INVOICE</h1>
      <div class="muted">${esc(f.code)}<br>${new Date().toISOString().slice(0, 10)}</div></div>
  </div>
  <h2>Guest</h2>
  <div>${esc(f.guest_name)}${f.guest_phone ? " · " + esc(f.guest_phone) : ""}${f.guest_email ? " · " + esc(f.guest_email) : ""}</div>
  <h2>Stay</h2>
  <table>
    <tr><th>Room type</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Nights</th><th style="text-align:right">Rate/night</th></tr>
    <tr><td>${esc(f.room_type_name)}</td><td>${esc(f.room_number || "—")}</td>
      <td>${esc(f.check_in)}</td><td>${esc(f.check_out)}</td><td>${f.nights}</td>
      <td style="text-align:right">${Number(f.nightly_rate).toLocaleString()} ${esc(f.currency)}</td></tr>
  </table>
  <h2>Payments</h2>
  <table>${rows || '<tr><td class="muted">No payments recorded</td></tr>'}</table>
  <table class="totals" style="margin-top:18px">
    <tr><td>Total for stay</td><td style="text-align:right">${Number(f.total).toLocaleString()} ${esc(f.currency)}</td></tr>
    <tr><td>Paid</td><td style="text-align:right">${Number(f.paid).toLocaleString()} ${esc(f.currency)}</td></tr>
    <tr class="grand"><td>Balance due</td><td style="text-align:right">${Number(f.balance).toLocaleString()} ${esc(f.currency)}</td></tr>
  </table>
  <p class="muted" style="margin-top:30px">Thank you for staying with us.</p>
  <button class="noprint" onclick="window.print()" style="margin-top:16px;padding:10px 22px">Print</button>
  </body></html>`);
  w.document.close();
}

// ---------------------------------------------------------------- settings
async function renderSettings() {
  const root = $("#page-settings");
  const isAdmin = state.user.role === "admin";
  let usersHTML = "";
  if (isAdmin) {
    const users = await api("/api/users");
    usersHTML = `
      <div class="panel">
        <h3>Staff accounts</h3>
        <table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
          ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
            <td><span class="badge badge-booked">${esc(u.role)}</span></td></tr>`).join("")}
        </tbody></table>
        <div style="margin-top:12px"><button class="btn btn-primary" id="user-new">Add staff account</button></div>
      </div>`;
  }
  root.innerHTML = `
    <div class="page-head"><div><h2>Settings</h2>
      <p class="page-sub">Signed in as ${esc(state.user.name)} (${esc(state.user.role)})</p></div></div>
    <div class="panel">
      <h3>Change my password</h3>
      <form id="pw-form" style="max-width:380px">
        <label>Current password<input type="password" name="current" required autocomplete="current-password"></label>
        <label>New password (min 8 characters)<input type="password" name="next" minlength="8" required autocomplete="new-password"></label>
        <button class="btn btn-primary" type="submit">Update password</button>
      </form>
    </div>
    ${usersHTML}`;

  $("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/change-password", { method: "POST",
        body: { current: fd.get("current"), next: fd.get("next") } });
      toast("Password updated"); e.target.reset();
    } catch (err) { toast(err.message, true); }
  });

  if (isAdmin) $("#user-new")?.addEventListener("click", () =>
    openModal("Add staff account", `
      <label>Name<input name="name" required></label>
      <label>Email<input type="email" name="email" required></label>
      <label>Password (min 8 characters)<input type="password" name="password" minlength="8" required></label>
      <label>Role
        <select name="role">
          <option value="staff">Staff</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
      </label>`,
      async (fd, close) => {
        await api("/api/users", { method: "POST", body: Object.fromEntries(fd) });
        close(); toast("Staff account created"); renderSettings();
      }, "Create account"));
}
