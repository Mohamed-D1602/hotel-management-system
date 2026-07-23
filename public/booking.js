/* Kanon Hotel — guest booking site (Signature Blue). */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let properties = [];
let currentSearch = null;

const ROOM_IMAGES = [
  "/img/room-suite.jpg", "/img/room-double.jpg", "/img/cafe-lounge.jpg",
  "/img/conference-1.jpg", "/img/bathroom.jpg", "/img/conference-2.jpg",
];

function currency() {
  const id = Number($("#search-hotel").value);
  return properties.find((p) => p.id === id)?.currency || "";
}
function money(v) {
  return v > 0 ? `${Number(v).toLocaleString()} ${currency()}` : "Rate on request";
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong — please try again");
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 4000);
}

/* ---------------- init ---------------- */
(async function init() {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  $("#search-in").value = today; $("#search-in").min = today;
  $("#search-out").value = tomorrow; $("#search-out").min = tomorrow;

  try {
    properties = await api("/api/public/properties");
    $("#search-hotel").innerHTML = properties
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  } catch (e) { toast(e.message, true); }
  preview();
})();

$("#search-in").addEventListener("change", () => {
  const inDate = $("#search-in").value;
  const next = new Date(new Date(inDate + "T00:00:00Z").getTime() + 86400000)
    .toISOString().slice(0, 10);
  $("#search-out").min = next;
  if ($("#search-out").value <= inDate) $("#search-out").value = next;
});
$("#search-hotel").addEventListener("change", () => { currentSearch = null; preview(); });

/* ---------------- preview (before dates chosen) ---------------- */
async function preview() {
  const id = Number($("#search-hotel").value);
  if (!id) return;
  try {
    const types = await api(`/api/public/properties/${id}/room-types`);
    $("#results-sub").textContent = "Choose your dates above to see live availability and rates.";
    render(types.map((t) => ({ ...t, available: null })));
  } catch (e) { toast(e.message, true); }
}

/* ---------------- search ---------------- */
$("#search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = Number($("#search-hotel").value);
  const check_in = $("#search-in").value, check_out = $("#search-out").value;
  try {
    const d = await api(`/api/public/properties/${id}/availability?check_in=${check_in}&check_out=${check_out}`);
    currentSearch = { property_id: id, check_in, check_out, nights: d.nights };
    const hotel = properties.find((p) => p.id === id);
    $("#results-sub").textContent =
      `${hotel.name} · ${check_in} → ${check_out} · ${d.nights} night${d.nights > 1 ? "s" : ""}`;
    render(d.room_types);
    document.getElementById("rooms").scrollIntoView({ behavior: "smooth" });
  } catch (err) { toast(err.message, true); }
});

function render(types) {
  const guests = Number($("#search-guests").value || 2);
  const root = $("#results");
  if (!types.length) {
    root.innerHTML = `<p class="results-note">Room details for this hotel are coming soon —
      please contact us directly.</p>`;
    return;
  }
  root.innerHTML = types.map((t, i) => {
    const searched = t.available !== null && t.available !== undefined;
    const canBook = !searched || t.available > 0;
    return `
    <article class="room">
      <div class="room-im" style="background-image:url('${ROOM_IMAGES[i % ROOM_IMAGES.length]}')"></div>
      <div class="room-bd">
        <h3>${esc(t.name)}</h3>
        <div class="room-price">${t.base_rate > 0
          ? `${money(t.base_rate)} <span>/ night</span>` : `Rate on request`}</div>
        <p class="room-desc">${esc(t.description || "")}</p>
        <div class="room-meta">Sleeps ${t.capacity}${t.capacity < guests ? " · smaller than your party" : ""}${
          searched && t.base_rate > 0 ? ` · ${money(t.total)} total` : ""}</div>
        ${searched ? (t.available > 0
          ? `<div class="room-avail">${t.available} room${t.available > 1 ? "s" : ""} available</div>`
          : `<div class="room-avail none">Fully booked for these dates</div>`) : ""}
        <button class="btn-dark" data-book="${t.id}" ${canBook ? "" : "disabled"}>
          ${searched ? "Book this room" : "Check dates to book"}</button>
      </div>
    </article>`;
  }).join("");

  root.querySelectorAll("[data-book]").forEach((b) =>
    b.addEventListener("click", () => {
      const t = types.find((x) => x.id === Number(b.dataset.book));
      if (!currentSearch) {
        toast("Choose your dates first, then press Search");
        document.querySelector(".book").scrollIntoView({ behavior: "smooth" });
        return;
      }
      bookingModal(t);
    }));
}

/* ---------------- booking ---------------- */
function bookingModal(type) {
  const hotel = properties.find((p) => p.id === currentSearch.property_id);
  const guests = Number($("#search-guests").value || 2);
  const root = $("#modal-root");
  root.innerHTML = "";
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <form class="modal">
      <h3>Reserve your stay</h3>
      <p class="modal-sub">${esc(type.name)} · ${esc(hotel.name)}<br />
        ${esc(currentSearch.check_in)} → ${esc(currentSearch.check_out)}
        (${currentSearch.nights} night${currentSearch.nights > 1 ? "s" : ""})
        ${type.base_rate > 0 ? ` · Total ${money(type.base_rate * currentSearch.nights)}` : ""}</p>
      <label>Full name<input name="full_name" required autocomplete="name" /></label>
      <div class="grid-2">
        <label>Phone<input name="phone" autocomplete="tel" placeholder="+249 ..." /></label>
        <label>Email<input type="email" name="email" autocomplete="email" /></label>
      </div>
      <div class="grid-2">
        <label>Adults<input type="number" name="adults" min="1" value="${Math.min(guests, type.capacity)}" /></label>
        <label>Children<input type="number" name="children" min="0" value="0" /></label>
      </div>
      <label>Special requests<textarea name="notes" rows="2"></textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn-quiet" data-close>Back</button>
        <button type="submit" class="btn-gold">Confirm booking</button>
      </div>
    </form>`;
  root.appendChild(back);
  const close = () => (root.innerHTML = "");
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  $("[data-close]", back).addEventListener("click", close);

  $("form", back).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const out = await api("/api/public/bookings", {
        method: "POST",
        body: {
          property_id: currentSearch.property_id, room_type_id: type.id,
          check_in: currentSearch.check_in, check_out: currentSearch.check_out,
          full_name: fd.get("full_name"), phone: fd.get("phone"), email: fd.get("email"),
          adults: Number(fd.get("adults")), children: Number(fd.get("children")),
          notes: fd.get("notes"),
        },
      });
      confirmation(out, type, hotel);
    } catch (err) { toast(err.message, true); }
  });
}

function confirmation(out, type, hotel) {
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="modal-back">
      <div class="modal">
        <h3>Booking confirmed</h3>
        <p class="modal-sub">We look forward to welcoming you.</p>
        <div class="confirm-box">
          <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#697585">Your reservation code</div>
          <div class="confirm-code">${esc(out.code)}</div>
          <div>${esc(type.name)} · ${esc(hotel.name)}<br />
            ${esc(currentSearch.check_in)} → ${esc(currentSearch.check_out)}
            (${out.nights} night${out.nights > 1 ? "s" : ""})<br />
            ${out.total > 0 ? `Total ${money(out.total)} — payable at the hotel`
                            : "Rate will be confirmed by the hotel"}</div>
        </div>
        <p style="font-size:13.5px;color:#697585">Please keep this code and quote it at reception
          on arrival. The hotel may contact you to confirm details.</p>
        <div class="modal-actions"><button class="btn-gold" data-close>Done</button></div>
      </div>
    </div>`;
  $("[data-close]", root).addEventListener("click", () => {
    root.innerHTML = "";
    $("#search-form").requestSubmit();
  });
}

/* ---------------- hero slideshow + sticky nav ---------------- */
(function () {
  const slides = document.querySelectorAll(".hero-slide");
  if (slides.length > 1) {
    let i = 0;
    setInterval(() => {
      slides[i].classList.remove("active");
      i = (i + 1) % slides.length;
      slides[i].classList.add("active");
    }, 6000);
  }
  const nav = $("#nav");
  window.addEventListener("scroll", () =>
    nav.classList.toggle("stuck", window.scrollY > 60), { passive: true });
})();
