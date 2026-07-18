# Hotel Management System

A generic, multi-brand hotel management system. Any hotel brand and any number of
properties can be managed from one installation. The first brand configured is
**Kanon Hotels**, with two locations:

- **Kanon Hotel Khartoum** — Street 15, Al-Amarat, Khartoum, Sudan (SDG)
- **Kanon Hotel Makkah** — Makkah, Saudi Arabia (SAR)

## Two applications in one

| URL | Who it's for |
|---|---|
| `/` | **Guests** — public booking website: browse both hotels, check live availability, and book online. Bookings appear instantly at the front desk. |
| `/admin` | **Staff** — front-desk system: dashboard, reservations, check-in/out, rooms, guests, rates, payments. Requires sign-in. |

## Features

- **Multi-brand / multi-property** — brands → properties → room types → rooms
- **Reservations** — create, assign rooms, check in, check out, cancel; overlap
  detection prevents double-booking a room
- **Availability search** — free rooms for any date range
- **Guests** — shared guest directory across all properties, with search
- **Room types & rates** — per-property rate card in the property's currency
- **Housekeeping** — clean / dirty / inspected room states; checkout marks rooms dirty
- **Payments** — record payments per reservation and track the outstanding balance
- **Dashboard** — occupancy, today's arrivals and departures, rooms to clean
- **Users & roles** — admin / manager / staff with token-based sign-in

## Tech stack

| Layer    | Choice                              |
|----------|-------------------------------------|
| Backend  | Node.js + Express                   |
| Database | SQLite (better-sqlite3, zero-config)|
| Frontend | Vanilla HTML/CSS/JS single-page app (no build step) |

## Getting started

```bash
npm install
npm start
```

Then open:

- **Guest booking site:** <http://localhost:3000>
- **Staff front desk:** <http://localhost:3000/admin>

**Default login:** `admin@kanon.example` / `admin123`
Change this password immediately after first sign-in (there is a
`/api/auth/change-password` endpoint; a settings screen can be added later).

The database is created automatically at `data/hms.sqlite` on first run and
seeded with the Kanon Hotels brand, both properties, sample room types, and a
starter block of rooms for Khartoum.

> **Note:** Khartoum room types and USD rates follow the official Kanon rate
> card. A starter inventory of 75 rooms is seeded using the real numbering
> pattern; extend to the full 124 from the Rooms screen.

## API overview

All endpoints require `Authorization: Bearer <token>` except login.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/public/properties` | (public) Hotels list |
| GET | `/api/public/properties/:id/availability?check_in=&check_out=` | (public) Availability by room type |
| POST | `/api/public/bookings` | (public) Create an online booking |
| POST | `/api/auth/login` | Sign in, returns token |
| GET | `/api/properties` | List properties |
| POST | `/api/properties` | Add property (admin) |
| GET | `/api/properties/:id/room-types` | Rate card |
| GET | `/api/properties/:id/rooms` | Room inventory |
| GET | `/api/properties/:id/availability?check_in=&check_out=` | Free rooms |
| GET/POST | `/api/properties/:id/reservations` | List / create reservations |
| POST | `/api/reservations/:id/check-in` | Check in (assigns room) |
| POST | `/api/reservations/:id/check-out` | Check out (room → dirty) |
| POST | `/api/reservations/:id/cancel` | Cancel |
| GET/POST | `/api/reservations/:id/payments` | Payments & balance |
| GET | `/api/guests?q=` | Search guests |
| GET | `/api/properties/:id/dashboard` | Occupancy, arrivals, departures |

## Project structure

```
server.js                  Express entry point
src/db.js                  Schema, seed data, password hashing
src/auth.js                Sessions, login, users
src/core-routes.js         Brands, properties, room types, rooms, guests
src/reservation-routes.js  Reservations, availability, payments, dashboard
public/                    Guest booking website (index.html, booking.css, booking.js)
public/admin/              Staff front-desk single-page app
src/public-routes.js       Public booking API (no login)
data/                      SQLite database (created at runtime, git-ignored)
```

## Pushing to GitHub

From inside this folder:

```bash
git init
git add .
git commit -m "Initial hotel management system"
git branch -M main
git remote add origin https://github.com/Mohamed-D1602/hotel-management-system.git
git push -u origin main
```

## Roadmap ideas

- Settings screen (change password, manage users from the UI)
- Invoices / folio printing
- Night audit and reporting (revenue by period, ADR, RevPAR)
- Housekeeping task assignments
- Arabic interface (RTL) alongside English
- Online booking widget for the Kanon Group website
