/* Kanon Hotels — guest booking site logic. */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let properties = [];
let currentSearch = null;

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
function toast(message, isError = false) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.toggle("error", isError);
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 4000);
}

// ---------------------------------------------------------------- init
(async function init() {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  $("#search-in").value = today;
  $("#search-in").min = today;
  $("#search-out").value = tomorrow;
  $("#search-out").min = tomorrow;

  try {
    properties = await api("/api/public/properties");
    $("#search-hotel").innerHTML = properties
      .map((p) => `<option value="${p.id}">${esc(p.name)} — ${esc(p.city)}</option>`)
      .join("");
  } catch (e) {
    toast(e.message, true);
  }
  renderRoomTypesPreview();
})();

$("#search-in").addEventListener("change", () => {
  const inDate = $("#search-in").value;
  const next = new Date(new Date(inDate + "T00:00:00Z").getTime() + 86400000)
    .toISOString().slice(0, 10);
  $("#search-out").min = next;
  if ($("#search-out").value <= inDate) $("#search-out").value = next;
});

$("#search-hotel").addEventListener("change", () => {
  currentSearch = null;
  renderRoomTypesPreview();
});

// ---------------------------------------------------------------- preview (no dates yet)
async function renderRoomTypesPreview() {
  const id = Number($("#search-hotel").value);
  if (!id) return;
  try {
    const types = await api(`/api/public/properties/${id}/room-types`);
    $("#results-sub").textContent = "Choose your dates above to see live availability and rates.";
    renderCards(types.map((t) => ({ ...t, available: null })));
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------- search
$("#search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = Number($("#search-hotel").value);
  const check_in = $("#search-in").value;
  const check_out = $("#search-out").value;
  try {
    const data = await api(
      `/api/public/properties/${id}/availability?check_in=${check_in}&check_out=${check_out}`);
    currentSearch = { property_id: id, check_in, check_out, nights: data.nights };
    const hotel = properties.find((p) => p.id === id);
    $("#results-sub").textContent =
      `${hotel.name} · ${check_in} → ${check_out} · ${data.nights} night${data.nights > 1 ? "s" : ""}`;
    renderCards(data.room_types);
    document.getElementById("stay").scrollIntoView({ behavior: "smooth" });
  } catch (err) { toast(err.message, true); }
});

function renderCards(types) {
  const guests = Number($("#search-guests").value || 2);
  const root = $("#results");
  if (!types.length) {
    root.innerHTML = `<p class="results-note">Room details for this hotel are coming soon —
      please check back, or contact the hotel directly.</p>`;
    return;
  }
  root.innerHTML = types.map((t) => {
    const fits = t.capacity >= guests;
    const searched = t.available !== null && t.available !== undefined;
    const canBook = (!searched || t.available > 0);
    return `
    <article class="room-card">
      <div class="room-visual"><span class="room-glyph">${esc(t.name.charAt(0))}</span></div>
      <div class="room-body">
        <h3>${esc(t.name)}</h3>
        <p class="room-desc">${esc(t.description || "")}</p>
        <div class="room-meta">Sleeps ${t.capacity}${fits ? "" : " · smaller than your party"}</div>
        <div class="room-price">
          ${t.base_rate > 0
            ? `<strong>${money(t.base_rate)}</strong> <small>/ night</small>
               ${searched ? `<small> · ${money(t.total)} total</small>` : ""}`
            : `<strong>Rate on request</strong>`}
        </div>
        ${searched
          ? (t.available > 0
              ? `<div class="room-availability">${t.available} room${t.available > 1 ? "s" : ""} available</div>`
              : `<div class="room-availability none">Fully booked for these dates</div>`)
          : ""}
      </div>
      <button class="btn-gold" data-book="${t.id}" ${canBook ? "" : "disabled"}
        ${canBook ? "" : 'style="opacity:.45;cursor:not-allowed"'}>
        ${searched ? "Book this room" : "Check dates to book"}
      </button>
    </article>`;
  }).join("");

  root.querySelectorAll("[data-book]").forEach((b) =>
    b.addEventListener("click", () => {
      const t = types.find((x) => x.id === Number(b.dataset.book));
      if (!currentSearch) {
        toast("Choose your dates first, then press Check availability");
        document.querySelector(".booking-bar").scrollIntoView({ behavior: "smooth" });
        return;
      }
      bookingModal(t);
    }));
}

// ---------------------------------------------------------------- booking
function bookingModal(type) {
  const hotel = properties.find((p) => p.id === currentSearch.property_id);
  const root = $("#modal-root");
  root.innerHTML = "";
  const guests = Number($("#search-guests").value || 2);

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
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
      <label>Special requests<textarea name="notes" rows="2" placeholder="Optional"></textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn-quiet" data-close>Back</button>
        <button type="submit" class="btn-gold">Confirm booking</button>
      </div>
    </form>`;
  root.appendChild(backdrop);

  const close = () => (root.innerHTML = "");
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  $("[data-close]", backdrop).addEventListener("click", close);

  $("form", backdrop).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const out = await api("/api/public/bookings", {
        method: "POST",
        body: {
          property_id: currentSearch.property_id,
          room_type_id: type.id,
          check_in: currentSearch.check_in,
          check_out: currentSearch.check_out,
          full_name: fd.get("full_name"),
          phone: fd.get("phone"),
          email: fd.get("email"),
          adults: Number(fd.get("adults")),
          children: Number(fd.get("children")),
          notes: fd.get("notes"),
        },
      });
      confirmationModal(out, type, hotel);
    } catch (err) { toast(err.message, true); }
  });
}

function confirmationModal(out, type, hotel) {
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h3>Booking confirmed</h3>
        <p class="modal-sub">We look forward to welcoming you.</p>
        <div class="confirm-box">
          <div>Your reservation code</div>
          <div class="confirm-code">${esc(out.code)}</div>
          <div>${esc(type.name)} · ${esc(hotel.name)}<br />
            ${esc(currentSearch.check_in)} → ${esc(currentSearch.check_out)}
            (${out.nights} night${out.nights > 1 ? "s" : ""})<br />
            ${out.total > 0 ? `Total ${money(out.total)} — payable at the hotel` : "Rate will be confirmed by the hotel"}</div>
        </div>
        <p style="font-size:14px;color:var(--ink-soft)">Please keep this code —
          quote it at reception on arrival. The hotel may contact you to confirm details.</p>
        <div class="modal-actions">
          <button type="button" class="btn-gold" data-close>Done</button>
        </div>
      </div>
    </div>`;
  $("[data-close]", root).addEventListener("click", () => {
    root.innerHTML = "";
    $("#search-form").requestSubmit(); // refresh availability
  });
}

// ---------------------------------------------------------------- flash: scroll effects
(function () {
  const top = document.querySelector(".top");
  window.addEventListener("scroll", () =>
    top.classList.toggle("scrolled", window.scrollY > 40), { passive: true });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible"); });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((s) => io.observe(s));
})();

// ---------------------------------------------------------------- flash: hero slideshow
(function () {
  const slides = document.querySelectorAll(".hero-slides .slide");
  if (slides.length > 1) {
    let i = 0;
    setInterval(() => {
      slides[i].classList.remove("active");
      i = (i + 1) % slides.length;
      slides[i].classList.add("active");
    }, 6000);
  }
})();

// ---------------------------------------------------------------- flash: animated counters
(function () {
  const nums = document.querySelectorAll(".counter-num");
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting || e.target.dataset.done) return;
      e.target.dataset.done = "1";
      const target = Number(e.target.dataset.count);
      const start = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - start) / 1400);
        e.target.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.4 });
  nums.forEach((n) => io.observe(n));
})();

// ---------------------------------------------------------------- flash L3
(function () {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // splash intro
  const splash = document.getElementById("splash");
  if (splash) setTimeout(() => splash.classList.add("done"), reduced ? 0 : 1500);

  // scroll progress bar
  const bar = document.getElementById("scroll-progress");
  window.addEventListener("scroll", () => {
    const h = document.documentElement;
    bar.style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight) * 100) + "%";
  }, { passive: true });

  // headline: word-by-word rise
  const h1 = document.querySelector(".hero h1");
  if (h1 && !reduced) {
    h1.innerHTML = h1.innerHTML.split(/<br\s*\/?>/i).map((line) =>
      line.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(" ")
    ).join("<br/>");
    h1.querySelectorAll(".w").forEach((w, i) => (w.style.animationDelay = (0.25 + i * 0.09) + "s"));
  }

  // gold dust particles
  const canvas = document.getElementById("gold-dust");
  if (canvas && !reduced) {
    const ctx = canvas.getContext("2d");
    let W, H, dots;
    const resize = () => {
      W = canvas.width = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
      dots = Array.from({ length: 42 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.6 + Math.random() * 1.8,
        vy: 0.12 + Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.15,
        tw: Math.random() * Math.PI * 2,
      }));
    };
    resize();
    window.addEventListener("resize", resize);
    (function draw(t) {
      ctx.clearRect(0, 0, W, H);
      for (const d of dots) {
        d.y -= d.vy; d.x += d.vx; d.tw += 0.03;
        if (d.y < -4) { d.y = H + 4; d.x = Math.random() * W; }
        const a = 0.25 + 0.45 * (0.5 + Math.sin(d.tw) / 2);
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(222,184,106,${a})`;
        ctx.shadowColor = "rgba(201,162,75,.8)"; ctx.shadowBlur = 6;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    })();
  }

  // 3D tilt on cards
  if (!reduced && matchMedia("(hover: hover)").matches) {
    document.addEventListener("mousemove", (e) => {
      const card = e.target.closest(".room-card, .gallery-grid figure");
      document.querySelectorAll(".room-card, .gallery-grid figure").forEach((c) => {
        if (c !== card) c.style.transform = "";
      });
      if (!card) return;
      const r = card.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -7;
      const ry = ((e.clientX - r.left) / r.width - 0.5) * 7;
      card.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px)`;
    });
  }
})();
