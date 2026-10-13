# GearUp Backend

**Sports & Outdoor Gear Rental API**  
Built with **Node.js · Express · TypeScript · PostgreSQL · Prisma ORM v7 · JWT · Stripe · Zod**

---

## 🚀 Project Overview

GearUp is a backend service for managing sports and outdoor gear rentals. It provides a robust API for customers, providers, and administrators, covering authentication, gear listings, rental orders, reviews, payments, and platform oversight.

### Current Implementation
- ✅ Project foundation & error handling (Phase 1)  
- ✅ Authentication & profile management (Phase 2)  
- ✅ Gear module (Phase 3)  
- ✅ Rental Order module with status state machine (Phase 4)  
- ✅ Reviews & Categories modules (public + admin CRUD)  
- ✅ Admin module (users, categories, gear, rentals, payments)  
- ✅ Payments module (Stripe integration: create + webhook)  

### Pending Work
- ❌ **SSLCommerz payment method** — schema/validation already supports it, but the service layer currently returns a “not supported yet” error.

---

## ⚙️ Prisma 7 Notes

Prisma v7 introduces major architectural changes:

- **No Rust engine binary** — Prisma Client now runs in TypeScript/WASM. Requires explicit driver adapter (`@prisma/adapter-pg` + `pg`).  
- **Client output** — generated into `src/generated/prisma` (gitignored). Run `npm run prisma:generate` after cloning.  
- **Datasource config** — moved to `prisma.config.ts` at project root.  
- **ESM runtime** — project runs as an ES module (`"type": "module"`) using `tsx`.  
  - Trade-off: Slight startup overhead vs compiled builds. The project already builds with `tsup` (`npm run build`) for production.

---

## 🛠️ Getting Started

```bash
npm install
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:seed
npm run dev

```

Server starts on `http://localhost:5000`. Check `GET /api/health` to confirm it's alive.

## Seeded Admin Credentials
```
Email:    admin@gearup.com
Password: Admin@123
```
Change these before any real deployment — the seed script is for local/dev convenience only.

## Scripts
| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server with hot reload (`tsx watch`) |
| `npm start` | Run the compiled server (`node dist/server.js`) — used in production |
| `npm run build` | Bundle to `dist/` with `tsup` |
| `npm test` | Run the test suite (Vitest) |
| `npm run type-check` | `tsc --noEmit` — catches type errors without emitting files |
| `npm run prisma:generate` | Regenerate Prisma client after schema changes |
| `npm run prisma:migrate` | Create + apply a dev migration |
| `npm run prisma:migrate:deploy` | Apply migrations in production (no prompts) |
| `npm run prisma:studio` | Open Prisma Studio DB browser |
| `npm run prisma:seed` | Re-run the seed script (admin + categories) |
| `npm run lint` / `lint:fix` | Lint / auto-fix |
| `npm run format` | Format with Prettier |

## Project Structure
```
src/
├── app.ts                  # Express app: middleware + route mounting
├── server.ts                # Entry point, graceful shutdown
├── config/                   # env, prisma client (driver adapter), stripe client
├── modules/                  # feature folders: routes / controller / service / validation
│   ├── auth/
│   └── gear/                 # gear.routes.ts (public) + provider-gear.routes.ts (provider CRUD)
├── middlewares/              # auth, role, validate, error, notFound
├── errors/                   # AppError + typed subclasses
├── utils/                    # logger, ApiResponse, catchAsync, pagination
├── constants/                 # roles
├── types/                    # Express Request augmentation
└── generated/prisma/          # Prisma Client output (gitignored, regenerate after clone)
```

## Response Contract
```json
// success
{ "success": true, "message": "...", "data": {...}, "meta": {...} }

// error
{ "success": false, "message": "...", "errorDetails": {...} }
```

## Database Schema

**Models:** `User`, `Category`, `Gear`, `RentalOrder`, `Payment`, `Review`
**Enums:** `Role`, `UserStatus`, `RentalStatus`, `PaymentStatus` (plus `PaymentMethod` as a bonus, to keep "stripe" vs "Stripe" typos out of the database)

**Cascade behavior summary:**
| Relation | onDelete | Why |
|---|---|---|
| `Gear.category → Category` | `Restrict` | Deleting a category with active gear should fail loudly, not orphan/nuke listings |
| `Gear.provider → User` | `Cascade` | Deleting a provider account removes their listings |
| `RentalOrder.customer → User` | `Restrict` | Order history is financial/audit data — suspend accounts, don't hard-delete them |
| `RentalOrder.gear → Gear` | `Restrict` | Historical orders must keep a valid reference for auditing |
| `Payment.rentalOrder → RentalOrder` | `Cascade` | A payment record has no meaning without its order |
| `Review.customer → User`, `Review.gear → Gear` | `Cascade` | A review is meaningless without either side |
| `Review.rentalOrder → RentalOrder` | `SetNull` | Review can stand alone as feedback even if the order record is ever removed |

**Indexes:** every foreign key, plus `User.role`/`status` (admin filtering), `Gear.isAvailable`/`pricePerDay`/`averageRating`/`brand` (search, filter, sort), `RentalOrder.status`/`startDate,endDate`, `Payment.status`, `Review.gearId`.

**Money fields** use `Decimal @db.Decimal(10, 2)` everywhere — never `Float`. `RentalOrder.pricePerDay` is snapshotted at order-creation time so a later provider price change never rewrites historical totals.

**`Gear.averageRating` / `Gear.reviewCount`** are denormalized columns, recalculated by the Reviews module whenever a review is created/updated/deleted — this keeps "sort by rating" a plain indexed column read instead of aggregating every review row per request.

## Migration & Generate Commands
```bash
npx prisma migrate dev --name init      # create + apply a migration
npx prisma generate                      # regenerate client after schema changes
npx prisma migrate deploy                # production/CI — no prompts, no new migration
npx prisma studio                         # visual DB browser
```

## Seed Script Strategy
`prisma/seed.ts` uses `upsert` (safe to re-run) to create:
1. **Admin** — `admin@gearup.com` / `Admin@123` — satisfies the mandatory admin-credentials requirement immediately after the first migration.
2. **5 starter categories** — Cycling, Camping, Fitness, Water Sports, Winter Sports — so gear has somewhere to attach to.

Registered in `prisma.config.ts` too, so `prisma migrate reset` runs it automatically.

## Phase 2 — Auth Endpoints
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Register as CUSTOMER or PROVIDER |
| POST | `/api/auth/login` | Public | Login, returns JWT |
| GET | `/api/auth/me` | Bearer token | Get current authenticated user |
| PATCH | `/api/auth/me` | Bearer token | Update profile — `name` and/or `phone` (email and role are not editable here) |
| PATCH | `/api/auth/me/password` | Bearer token | Change password — body: `{ currentPassword, newPassword }` |

```json
POST /api/auth/register
{ "name": "Jane Doe", "email": "jane@example.com", "password": "supersecret123", "role": "CUSTOMER", "phone": "+8801700000000" }

POST /api/auth/login
{ "email": "jane@example.com", "password": "supersecret123" }

PATCH /api/auth/me
{ "name": "Jane R. Doe", "phone": "+8801700000001" }

PATCH /api/auth/me/password
{ "currentPassword": "supersecret123", "newPassword": "evenmoresecret456" }
```
Login/register responses include `data.token` — send it as `Authorization: Bearer <token>` on protected routes.

## Phase 3 — Gear Endpoints
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/gear` | Public | List gear — search, filter, sort, paginate |
| GET | `/api/gear/:id` | Public | Get single gear details |
| GET | `/api/provider/gear` | PROVIDER | List only your own gear |
| POST | `/api/provider/gear` | PROVIDER | Create gear |
| PUT | `/api/provider/gear/:id` | PROVIDER (owner only) | Update gear you own |
| DELETE | `/api/provider/gear/:id` | PROVIDER (owner only) | Delete gear you own |

**Public listing query params** (all optional):
```
GET /api/gear?search=tent&categoryId=<uuid>&minPrice=10&maxPrice=100
    &isAvailable=true&page=1&limit=10&sortBy=rating&sortOrder=desc
```
- `search` — matches `title` OR `brand`, case-insensitive
- `sortBy` — `price` | `rating` | `newest` (default `newest`)
- `sortOrder` — `asc` | `desc` (default `desc`)
- Response includes `meta: { page, limit, total, totalPages }`

```json
POST /api/provider/gear
Authorization: Bearer <provider-token>
{
  "title": "Trek Mountain Bike",
  "description": "21-speed hardtail, great for trail riding",
  "brand": "Trek",
  "pricePerDay": 25.00,
  "stock": 3,
  "categoryId": "<category-uuid>",
  "images": ["https://example.com/bike.jpg"]
}
```

**Ownership enforcement:** `PUT`/`DELETE` on `/api/provider/gear/:id` return `404` if the gear doesn't exist, `403` if it exists but belongs to a different provider — checked in the service layer (`assertOwnership`), not just by role/route.

## Phase 4 — Rental Order Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/rentals` | CUSTOMER | Create a rental order |
| GET | `/api/rentals` | CUSTOMER | List your own rental orders (filter by `status`, paginated) |
| GET | `/api/rentals/:id` | Owner customer or owning provider | Get order details |
| PATCH | `/api/rentals/:id/cancel` | CUSTOMER (owner) | Cancel — only while `status = PLACED` |
| GET | `/api/provider/orders` | PROVIDER | List incoming orders for your gear |
| PATCH | `/api/provider/orders/:id/status` | PROVIDER (owner) | Advance order status |

**Create rental order:**
```json
POST /api/rentals
Authorization: Bearer <customer-token>
{ "gearId": "<uuid>", "quantity": 1, "startDate": "2026-07-10", "endDate": "2026-07-13" }
```
`totalDays` and `totalAmount` are calculated server-side — never trust a client-supplied price. `totalDays` is whole calendar days between the two dates, rounded up, minimum 1.

**Order status state machine:**
```
PLACED ──confirm──▶ CONFIRMED ──(payment)──▶ PAID ──pickup──▶ PICKED_UP ──return──▶ RETURNED
  │                     │
  └──cancel──▶ CANCELLED ◀──cancel──┘   (customer only, and only from PLACED)
```
`PATCH /api/provider/orders/:id/status` accepts `CONFIRMED | PICKED_UP | RETURNED`. Every transition is checked against the order's *current* status — jumping straight from `PLACED` to `PICKED_UP`, for instance, is rejected with a 400 explaining which transitions are actually valid from where the order currently is.

**Stock handling (Prisma transactions):**
- **On create** — stock is decremented via `updateMany` with `stock: { gte: quantity }` in the `WHERE` clause, evaluated atomically by Postgres. If two customers race for the last unit, only one update matches; the other gets a clean `409 Conflict` instead of a race condition or negative stock.
- **On cancel / on RETURNED** — stock is incremented back inside a `$transaction`, alongside the status update, so the two writes commit or fail together.

**Authorization layers:**
- Role check (`CUSTOMER` / `PROVIDER`) via middleware.
- Ownership check in the service layer: a customer can only cancel/view their own orders; a provider can only manage/view orders on gear they own. `GET /api/rentals/:id` is shared by both roles — the service decides access, not the route.


- Reviews module recalculates `Gear.averageRating`/`reviewCount` when a review is created. (Editing and deleting reviews are not implemented yet.)
- Rentals module reduces `Gear.stock` when an order is **created**, and restores it on cancellation/return.

## Phase 5 — Admin Module

All admin endpoints require a Bearer token for a user with `role: ADMIN` (seeded credentials above). Every route is protected by `verifyTokenMiddleware` + `verifyRole(Role.ADMIN)` mounted once per router, same pattern as `provider-gear.routes.ts`.

**Gear** (`/api/admin/gear`) — added to the existing `modules/gear/` module rather than duplicated, following the same split as `gear.routes.ts` (public) vs. `provider-gear.routes.ts` (owner-scoped):
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/gear` | ADMIN | List every gear listing platform-wide — filter by `providerId`, `categoryId`, `isAvailable`, `search`, price range, paginated. Unlike the public listing, `isAvailable` can be omitted to include out-of-stock/hidden listings |
| GET | `/api/admin/gear/:id` | ADMIN | Get one gear listing (reuses the public detail handler — gear details aren't ownership-scoped) |

**Categories** (`/api/categories` public, `/api/admin/categories` admin) — lives in `modules/categories/`, split the same way Gear splits public vs. provider-owned routes:
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/categories` | Public | List all categories |
| GET | `/api/categories/:id` | Public | Get one category |
| GET | `/api/admin/categories` | ADMIN | List all categories (same shape, admin-only mount) |
| GET | `/api/admin/categories/:id` | ADMIN | Get one category |
| POST | `/api/admin/categories` | ADMIN | Create a category |
| PUT | `/api/admin/categories/:id` | ADMIN | Update a category |
| DELETE | `/api/admin/categories/:id` | ADMIN | Delete a category — blocked with a `409` if any gear is still assigned to it |

**Users** (`/api/admin/users`) — lives in `modules/users/`:
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/users` | ADMIN | List all users — filter by `role`, `status`, `search` (name/email), paginated |
| PATCH | `/api/admin/users/:id` | ADMIN | Suspend or activate a user — body: `{ "status": "SUSPENDED" \| "ACTIVE" }` |

Admin accounts can't be suspended/activated through this endpoint at all (returns `403`), even by another admin — this closes off the failure mode where a platform ends up with zero usable admin accounts.

**Rentals** (`/api/admin/rentals`) — added to the existing `modules/rentals/` module rather than duplicated, since `getRentalByIdForUser` already special-cased `role === ADMIN` to bypass the ownership check:
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/rentals` | ADMIN | List every rental order platform-wide — filter by `status`, `customerId`, `providerId`, paginated |
| GET | `/api/admin/rentals/:id` | ADMIN | Get any single rental order's full details |

**Payments** (`/api/admin/payments`) — oversight endpoints in `modules/payments/`, alongside the customer-facing create flow documented in Phase 6 below:
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/payments` | ADMIN | List every payment record — filter by `status`, `method`, paginated |
| GET | `/api/admin/payments/:id` | ADMIN | Get one payment, including the linked rental order/customer/gear |

## Phase 6 — Payments (Stripe)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/payments/create` | CUSTOMER | Creates a Stripe PaymentIntent for a `CONFIRMED` rental order, returns `clientSecret` |
| GET | `/api/payments` | CUSTOMER | Own payment history — filter by `status`, `method`, paginated |
| GET | `/api/payments/:id` | CUSTOMER | One payment (ownership-checked) |
| POST | `/api/payments/webhook/stripe` | Stripe (signed) | Marks the payment COMPLETED/FAILED and moves the order `CONFIRMED → PAID` |

```json
POST /api/payments/create
{ "rentalOrderId": "<uuid>", "method": "STRIPE" }
```
The response's `data.clientSecret` is passed to Stripe.js on the frontend (`stripe.confirmCardPayment(clientSecret)`) to actually collect card details and confirm the charge — **there is no `POST /api/payments/confirm` for Stripe**. Confirmation happens directly between the client and Stripe; the webhook below is the only trustworthy place the real outcome reaches this server, since it's cryptographically signed and can't be spoofed by a client claiming "it succeeded".

**Webhook wiring:** `/api/payments/webhook` is mounted in `app.ts` with `express.raw({ type: 'application/json' })` **before** the global `express.json()` — Stripe's signature check needs the exact raw request bytes. Point your Stripe CLI or dashboard webhook at `POST {APP_BASE_URL}/api/payments/webhook/stripe`, listening for `payment_intent.succeeded` and `payment_intent.payment_failed`.

**Order lifecycle tightened:** now that Payments exists, `CONFIRMED → PICKED_UP` is no longer a legal direct transition — pickup only happens after `PAID`. See the updated table in `constants/orderStatus.ts`.

**Retry behavior:** `Payment.rentalOrderId` is `@unique` in the schema (one payment record per order, ever). A retry after a failed/abandoned attempt updates the existing row with a fresh PaymentIntent rather than inserting a second one.

**SSLCommerz:** the `PaymentMethod` enum and `createPaymentSchema` already accept `SSLCOMMERZ`, but `createStripePayment` rejects it with a clear `400` — it isn't implemented yet. Building it out is a self-contained follow-up (SSLCommerz has no official SDK; integration is a plain form-encoded HTTP call to their Session API + a GET call to their Validator API).
