// Hotel Management System — server entry point.
// Generic multi-brand HMS. First brand: Kanon Hotels (Khartoum + Jeddah).

const path = require("path");
const express = require("express");

const { registerAuthRoutes } = require("./src/auth");
const { registerCoreRoutes } = require("./src/core-routes");
const { registerReservationRoutes } = require("./src/reservation-routes");
const { registerPublicRoutes } = require("./src/public-routes");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

registerAuthRoutes(app);
registerCoreRoutes(app);
registerReservationRoutes(app);
registerPublicRoutes(app);

// Health check
app.get("/api/health", (req, res) => res.json({ ok: true, service: "hms" }));

// Fallbacks: /admin → front-desk app, everything else → guest booking site
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
  if (req.path === "/admin" || req.path.startsWith("/admin/")) {
    return res.sendFile(path.join(__dirname, "public", "admin", "index.html"));
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Hotel Management System running on http://localhost:${PORT}`);
  console.log("Default login: admin@kanon.example / admin123  (change it after first sign-in)");
});
