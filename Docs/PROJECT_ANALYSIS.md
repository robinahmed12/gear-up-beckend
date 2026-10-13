# GearUp Backend — Project Analysis

> **Sports & Outdoor Gear Rental Marketplace API**
> Verified against the actual source code (not the README). Every claim in this
> document was cross-checked against the implementation; where the README and
> the code disagree, the discrepancy is documented in
> [Section 13](#13-verified-discrepancies--bugs).

- **Repository:** `gearup-backend`
- **Version:** 1.0.0
- **Analysis date:** 2026-10-13
- **Verified against:** `src/**`, `prisma/schema.prisma`, `prisma/migrations/`, root config files

---

## 1. Purpose & Scope

This document is a code-verified analysis of the GearUp backend. It covers the
architecture, modules, API endpoints, database schema, authentication,
authorization, business workflows, and production-readiness gaps.

It intentionally does **not** restate the README. It is a reference for planning
the evolution of the product into a production-ready SaaS platform.

**Out of scope / assumed boundaries:**

- `src/generated/prisma/**` is Prisma-generated output (gitignored, produced by
  `npm run prisma:generate`) and is **not** hand-written.
- `node_modules/**` is third-party dependency code.

---

## 2. Executive Summary

GearUp is a **modular Express 4 + TypeScript monolith** for managing sports and
outdoor gear rentals, backed by **PostgreSQL via Prisma ORM 7** (with the
`@prisma/adapter-pg` driver adapter). It exposes a public catalog plus
role-scoped APIs for `CUSTOMER`, `PROVIDER`, and `ADMIN`, and integrates
**Stripe** for payments.

**Strengths observed in the code:**

- Clean, consistent per-feature layering: `routes -> controller -> service -> validation`.
- A single, standardized response envelope for success and errors.
- Real concurrency safety: stock is reserved with an atomic
  `updateMany ... stock: { gte: quantity }` (`rental.service.ts:71`).
- An explicit rental order **state machine** with guarded transitions
  (`constants/orderStatus.ts:25`).
- **Idempotent** Stripe webhook handling (`payment.service.ts:240`).
- Denormalized `Gear.averageRating`/`reviewCount` recalculated transactionally
  (`review.service.ts:32`).
- Correct cascade behavior and useful indexes in the database schema.
- Fail-fast environment validation (`config/env.ts`).

**Principal gaps (detailed later):**

- No automated tests, no CI, no Docker/post-deploy config for the API itself.
- Auth has no email verification, password reset, refresh tokens, or logout;
  no rate limiting.
- Reviews are create/read only (no update/delete/moderation).
- Payments have no refunds, deposits, payouts, tax, or multi-currency;
  currency is hardcoded to `usd`.
- Rental availability is stock-based only — no date-range conflict detection.
- Several verified bugs/config issues (CORS, boolean coercion, missing
  `/api/health`, missing `.env.example`).

---

## 3. Tech Stack & Runtime

Verified from `package.json`, `tsconfig.json`, `tsup.config.ts`, `vercel.json`.

| Area | Choice |
|---|---|
| Runtime | Node.js `>=20.0.0`, ES Modules (`"type": "module"`) |
| Language | TypeScript 5.6, `strict: true`, `moduleResolution: bundler` |
| Web framework | Express `^4.21.0` |
| ORM | Prisma `^7.8.0` + `@prisma/adapter-pg` + `pg` |
| Database | PostgreSQL |
| Validation | Zod `^3.23.8` |
| Auth | `jsonwebtoken` `^9.0.2` + `bcryptjs` `^2.4.3` |
| Payments | Stripe `^16.12.0` |
| Logging | Winston `^3.14.2` |
| Security middleware | `helmet` `^7.1.0`, `cors` `^2.8.5` |
| Dev/build | `tsx` (dev/watch), `tsup` (bundle to `dist/`) |
| Lint/format | ESLint 8 + `@typescript-eslint`, Prettier 3 |
| Deploy target | Vercel (`vercel.json` routes all traffic to `dist/server.js`) |

**Runtime model (Prisma 7):** no Rust engine binary; the client is generated TS
into `src/generated/prisma` and requires an explicit driver adapter
(`config/prisma.ts:20`).

**Scripts** (`package.json`):

| Script | Command |
|---|---|
| `npm run dev` | `tsx watch ./src/server.ts` |
| `npm start` | `node dist/server.js` |
| `npm run build` | `tsup` |
| `npm run type-check` | `tsc --noEmit -p tsconfig.json` |
| `npm run lint` / `lint:fix` | `eslint "src/**/*.ts"` |
| `npm run format` / `format:check` | `prettier` |
| `npm run prisma:generate` | `prisma generate` |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:migrate:deploy` | `prisma migrate deploy` |
| `npm run prisma:studio` | `prisma studio` |
| `npm run prisma:seed` | `tsx prisma/seed.ts` |
| `postinstall` | `prisma generate` |

---

## 4. Repository Layout

```
gear-up-beckend/
├── prisma/
│   ├── schema.prisma            # data model, enums, relations, indexes
│   ├── seed.ts                  # admin + baseline categories
│   └── migrations/
│       └── 20260709164337_init/migration.sql
├── src/
│   ├── app.ts                   # Express app: middleware + route mounting
│   ├── server.ts                # entry point: listen + graceful shutdown
│   ├── config/
│   │   ├── env.ts               # Zod-validated environment variables
│   │   ├── prisma.ts            # shared PrismaClient + pg adapter
│   │   └── stripe.ts            # shared Stripe client (pinned apiVersion)
│   ├── constants/
│   │   ├── orderStatus.ts       # rental state machine + helpers
│   │   └── roles.ts             # Role re-export
│   ├── errors/                  # AppError + typed subclasses
│   │   ├── AppError.ts
│   │   ├── ConflictError.ts     # 409
│   │   ├── ForbiddenError.ts    # 403
│   │   ├── NotFoundError.ts     # 404
│   │   ├── UnauthorizedError.ts # 401
│   │   └── ValidationError.ts   # 400
│   ├── middlewares/
│   │   ├── auth.middleware.ts   # Bearer verify + DB re-fetch
│   │   ├── role.middleware.ts   # verifyRole(...)
│   │   ├── validate.middleware.ts # Zod validate body/query/params
│   │   ├── error.middleware.ts  # global error handler
│   │   └── notFound.middleware.ts
│   ├── modules/
│   │   ├── auth/                # register/login/me/profile/password
│   │   ├── gear/                # public + provider + admin gear routes
│   │   ├── rentals/             # customer + provider + admin rentals
│   │   ├── reviews/             # create + list-for-gear
│   │   ├── categories/          # public + admin categories
│   │   ├── users/               # admin user management
│   │   └── payments/            # Stripe intent + webhook + oversight
│   ├── types/
│   │   └── express.d.ts         # Request.user augmentation
│   └── utils/
│       ├── ApiResponse.ts       # sendSuccess helper
│       ├── catchAsync.ts        # async error forwarding
│       ├── jwt.ts               # sign/verify
│       ├── logger.ts            # Winston
│       ├── pagination.ts        # skip/take + meta
│       ├── password.ts          # bcrypt hash/compare
│       └── rentalDates.ts       # totalDays calculation
├── package.json
├── prisma.config.ts
├── tsconfig.json
├── tsup.config.ts
├── vercel.json
└── README.md
```

**Not present (verified):** `.env.example`, any `*.test.ts`/`*.spec.ts`, CI
workflows, `Dockerfile`, `docker-compose.yml`.

---

## 5. Architecture & Request Lifecycle

`app.ts` builds the Express application in a fixed order:

1. `helmet()` — security headers.
2. `cors({ origin: env.CORS_ORIGIN, credentials: true })`.
3. `morgan(...)` — HTTP request logging.
4. **`/api/payments/webhook`** mounted with `express.raw({ type: 'application/json' })`
   **before** the global JSON parser (`app.ts:44`), because Stripe's signature
   verification needs the exact raw bytes.
5. `express.json()` + `express.urlencoded()`.
6. `GET /` — liveness-ish root handler returning uptime (`app.ts:50`).
7. Feature routers, then admin routers.
8. `notFoundHandler`, then the global error handler (must be last; the error
   handler keeps all four params to be recognized by Express).

**Layering per module:** a `*.routes.ts` file attaches
`verifyTokenMiddleware` / `verifyRole(...)` / `validate(...)` and delegates to a
controller, which delegates to a service that owns Prisma access and
authorization logic. Controllers are wrapped in `catchAsync` so rejected
promises flow to the global error handler.

**Shared infrastructure:**

- A single `PrismaClient` is cached on `global` outside production to survive
  dev hot-reloads (`config/prisma.ts:22`).
- `server.ts` registers `SIGTERM`/`SIGINT` for graceful shutdown (close server,
  disconnect Prisma), plus `unhandledRejection`/`uncaughtException` safety nets.

---

## 6. Configuration & Environment

All environment variables are declared and validated once at startup in
`config/env.ts` using Zod, and the process throws a clear error if any required
variable is missing/malformed.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` / `test` / `production` |
| `PORT` | No | `5000` | |
| `CORS_ORIGIN` | No | `*` | **Insecure default; see §13** |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `JWT_SECRET` | **Yes** | — | min 10 chars |
| `JWT_EXPIRES_IN` | No | `7d` | |
| `BCRYPT_SALT_ROUNDS` | No | `12` | |
| `STRIPE_SECRET_KEY` | **Yes** | — | |
| `STRIPE_WEBHOOK_SECRET` | **Yes** | — | |
| `SSLCOMMERZ_STORE_ID` | No | — | unused (method not implemented) |
| `SSLCOMMERZ_STORE_PASSWORD` | No | — | unused |
| `SSLCOMMERZ_IS_LIVE` | No | `false` | boolean-coercion bug; see §13 |
| `APP_BASE_URL` | No | `http://localhost:5000` | used for webhook URL docs |

`prisma.config.ts` reads `DATABASE_URL` for the datasource (Prisma 7 moved the
datasource URL out of `schema.prisma`).

> **Missing:** `.env.example`. The README instructs `cp .env.example .env`, but
> no such file exists in the repository.

## 7. Data Model

Verified from `prisma/schema.prisma` and the init migration. Table names use
`@@map` (e.g. `User` -> `users`, `Gear` -> `gear_items`).

### 7.1 Enums

| Enum | Values |
|---|---|
| `Role` | `CUSTOMER`, `PROVIDER`, `ADMIN` |
| `UserStatus` | `ACTIVE`, `SUSPENDED` |
| `RentalStatus` | `PLACED`, `CONFIRMED`, `PAID`, `PICKED_UP`, `RETURNED`, `CANCELLED` |
| `PaymentStatus` | `PENDING`, `COMPLETED`, `FAILED`, `REFUNDED` |
| `PaymentMethod` | `STRIPE`, `SSLCOMMERZ` |

### 7.2 Models

**`User`** (`users`)
`id (uuid)`, `name`, `email (unique)`, `password`, `role`, `status (default ACTIVE)`,
`phone?`, `createdAt`, `updatedAt`.
Relations: `gearItems[]` (ProviderGear), `rentalOrders[]` (CustomerRentals), `reviews[]`.
Indexes: `role`, `status`.

**`Category`** (`categories`)
`id`, `name (unique)`, `description?`, timestamps. Relation: `gearItems[]`.

**`Gear`** (`gear_items`)
`id`, `title`, `description`, `brand?`, `pricePerDay Decimal(10,2)`, `stock (default 1)`,
`isAvailable (default true)`, `images String[]`, `averageRating Float (default 0)`,
`reviewCount Int (default 0)`, timestamps, `categoryId`, `providerId`.
Indexes: `categoryId`, `providerId`, `isAvailable`, `pricePerDay`, `averageRating`, `brand`.

**`RentalOrder`** (`rental_orders`)
`id`, `quantity (default 1)`, `startDate`, `endDate`, `totalDays`, `pricePerDay
Decimal(10,2)` (snapshot), `totalAmount Decimal(10,2)`, `status (default PLACED)`,
timestamps, `customerId`, `gearId`. Relations: `payment?`, `review?`.
Indexes: `customerId`, `gearId`, `status`, `(startDate, endDate)`.

**`Payment`** (`payments`)
`id`, `transactionId (unique)`, `amount Decimal(10,2)`, `method`, `status (default PENDING)`,
`paidAt?`, `rawResponse Json?`, timestamps, `rentalOrderId (unique)`.
Index: `status`.

**`Review`** (`reviews`)
`id`, `rating Int`, `comment?`, timestamps, `customerId`, `gearId`,
`rentalOrderId? (unique)`. Unique: `(customerId, gearId)`. Index: `gearId`.

### 7.3 Relations & Cascade Behavior (verified)

| Relation | onDelete | Rationale (from schema comments) |
|---|---|---|
| `Gear.category -> Category` | `Restrict` | Fail loudly rather than orphan/nuke listings |
| `Gear.provider -> User` | `Cascade` | Deleting a provider removes their listings |
| `RentalOrder.customer -> User` | `Restrict` | Order history is financial/audit data |
| `RentalOrder.gear -> Gear` | `Restrict` | Historical orders keep a valid reference |
| `Payment.rentalOrder -> RentalOrder` | `Cascade` | A payment has no meaning without its order |
| `Review.customer -> User` | `Cascade` | Review meaningless without the customer |
| `Review.gear -> Gear` | `Cascade` | Review meaningless without the gear |
| `Review.rentalOrder -> RentalOrder` | `SetNull` | Review can stand alone as feedback |

### 7.4 Modeling Notes

- **Money** is `Decimal @db.Decimal(10, 2)` everywhere — never `Float`.
- `RentalOrder.pricePerDay` is **snapshotted** at order creation so later price
  changes never rewrite historical totals.
- `Gear.averageRating` / `reviewCount` are **denormalized**, recalculated by the
  reviews module inside the same transaction as each review write.
- `Payment.rentalOrderId` is `@unique` — **one payment record per order, ever**
  (retries update the row rather than inserting a second).

---

## 8. API Surface (Complete Route Inventory)

Base path prefix `/api`. Auth column is the effective requirement, including
in-service ownership checks.

### Auth — `/api/auth`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | Public | Register as CUSTOMER/PROVIDER, returns JWT |
| POST | `/login` | Public | Login, returns JWT |
| GET | `/me` | Any token | Current user profile |
| PATCH | `/me` | Any token | Update `name`/`phone` |
| PATCH | `/me/password` | Any token | Change password |

### Gear
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/gear` | Public | Search/filter/sort/paginate listings |
| GET | `/api/gear/:id` | Public | Single gear detail |
| GET | `/api/provider/gear` | PROVIDER | Own inventory |
| POST | `/api/provider/gear` | PROVIDER | Create gear |
| PUT | `/api/provider/gear/:id` | PROVIDER (owner) | Update own gear |
| DELETE | `/api/provider/gear/:id` | PROVIDER (owner) | Delete own gear |
| GET | `/api/admin/gear` | ADMIN | Platform-wide gear list |
| GET | `/api/admin/gear/:id` | ADMIN | Any gear detail |

### Rentals
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/rentals` | CUSTOMER | Place order (atomic stock reserve) |
| GET | `/api/rentals` | CUSTOMER | Own orders |
| GET | `/api/rentals/:id` | Owner customer / owning provider / ADMIN | Order detail |
| PATCH | `/api/rentals/:id/cancel` | CUSTOMER (owner) | Cancel from `PLACED` |
| GET | `/api/provider/orders` | PROVIDER | Incoming orders for own gear |
| PATCH | `/api/provider/orders/:id/status` | PROVIDER (owner) | Advance status |
| GET | `/api/admin/rentals` | ADMIN | All orders |
| GET | `/api/admin/rentals/:id` | ADMIN | Any order detail |

### Reviews
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/reviews` | CUSTOMER | Create review (order must be `RETURNED`) |
| GET | `/api/gear/:id/reviews` | Public | Paginated reviews for a gear item |

> No update/delete/moderation endpoints exist (verified).

### Categories
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/categories` | Public | List categories |
| GET | `/api/categories/:id` | Public | Category detail |
| GET | `/api/admin/categories` | ADMIN | List (admin mount) |
| GET | `/api/admin/categories/:id` | ADMIN | Detail (admin mount) |
| POST | `/api/admin/categories` | ADMIN | Create |
| PUT | `/api/admin/categories/:id` | ADMIN | Update |
| DELETE | `/api/admin/categories/:id` | ADMIN | Delete (409 if gear attached) |

### Users
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/users` | ADMIN | List/filter users |
| PATCH | `/api/admin/users/:id` | ADMIN | Suspend/activate (admin accounts protected) |

### Payments
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/payments/create` | CUSTOMER | Create Stripe PaymentIntent -> `clientSecret` |
| GET | `/api/payments` | CUSTOMER | Own payment history |
| GET | `/api/payments/:id` | CUSTOMER | Own payment detail |
| POST | `/api/payments/webhook/stripe` | Stripe signature | Mark COMPLETED/FAILED; order -> `PAID` |
| GET | `/api/admin/payments` | ADMIN | All payments |
| GET | `/api/admin/payments/:id` | ADMIN | Any payment detail |

### Misc
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Public | Root health-ish message + uptime |

**Total:** 38 routes across 7 modules.

---

## 9. Module-by-Module Analysis

### 9.1 Auth (`src/modules/auth/`)

- `registerUser` (`auth.service.ts:25`): rejects duplicate email (`ConflictError`),
  bcrypt-hashes the password, creates the user, returns a JWT. Public
  registration only allows `CUSTOMER`/`PROVIDER` (`auth.validation.ts:24`).
  `ADMIN` is provisioned via seed.
- `loginUser` (`auth.service.ts:50`): identical "Invalid email or password"
  message for unknown email vs. wrong password (prevents account enumeration),
  blocks `SUSPENDED` accounts, strips `password` before returning.
- `getCurrentUser`, `updateProfile` (name/phone only), `changePassword`
  (`auth.service.ts:102`) with current-password verification and a
  `new != current` refinement.
- JWT payload contains only `{ id, role }` (`utils/jwt.ts:15`); email/PII are
  never embedded.

### 9.2 Gear (`src/modules/gear/`)

- Public listing (`gear.service.ts:98`) supports `search` (title OR brand,
  case-insensitive), `categoryId`, `minPrice`/`maxPrice`, `isAvailable`, and
  sorting by `price` | `rating` | `newest` with `asc`/`desc`.
- `createGear` validates category existence; `assertOwnership`
  (`gear.service.ts:165`) returns `404` if missing, `403` if owned by another
  provider.
- Provider listing (`listProviderGear`) and admin listing (`listGearForAdmin`,
  which can include unavailable gear and filter by provider) share the same
  query builder.

### 9.3 Rentals (`src/modules/rentals/`)

- `createRentalOrder` (`rental.service.ts:46`): loads gear, rejects unavailable
  gear, computes `totalDays` (`utils/rentalDates.ts`) and `totalAmount`
  server-side, then in a transaction performs an atomic `updateMany` with
  `stock: { gte: quantity }`. If two customers race for the last unit, only one
  update matches; the other receives a clean `409`. New order starts `PLACED`.
- Access control: `getRentalByIdForUser` (`rental.service.ts:181`) allows the
  owning customer, owning provider, or `ADMIN`; everyone else gets `403`.
- `updateOrderStatus` (provider only, owner-checked) delegates transition
  legality to `assertValidTransition`; `RETURNED` restores stock in a
  transaction.
- `cancelRentalOrder` (`rental.service.ts:281`): customer-owned and only from a
  legal state; restores stock transactionally.
- `markOrderAsPaid` is called only by the payment webhook handler.

### 9.4 Reviews (`src/modules/reviews/`)

- `createReview` (`review.service.ts:63`) enforces, in order: order exists ->
  belongs to the requesting customer -> status is `RETURNED` -> not already
  reviewed. Then it writes the review and recalculates
  `Gear.averageRating`/`reviewCount` in the same transaction
  (`recalculateGearRating`, `review.service.ts:32`).
- `getReviewsForGear` paginates reviews for a gear item.
- **No update/delete/moderation** exists despite README claims (see Section 13).

### 9.5 Categories (`src/modules/categories/`)

- Public `list`/`getById`; admin `create`/`update`/`delete`.
- `deleteCategory` (`category.service.ts:60`) blocks deletion with a `409` if
  gear is still attached, avoiding an opaque FK `P2003`.
- `_count.gearItems` is included so the admin UI can show usage counts.

### 9.6 Users (`src/modules/users/`)

- Admin-only `listUsers` with `search`/`role`/`status` filters and pagination.
- `updateUserStatus` (`user.service.ts:74`) suspends/activates a user but
  **refuses to touch any `ADMIN` account** (`403`), preventing platform lockout.
- Password is excluded from every select in this module.

### 9.7 Payments (`src/modules/payments/`)

- `createStripePayment` (`payment.service.ts:148`): rejects non-STRIPE methods
  with a `400`, requires the order to belong to the customer and be
  `CONFIRMED`, prevents re-paying a completed payment, creates a Stripe
  `PaymentIntent` (amount converted to cents), and upserts the single `Payment`
  row (create on first attempt, update on retry). Returns `clientSecret`.
- Webhook (`payment.webhook.ts`): verifies the Stripe signature using the raw
  body; `payment_intent.succeeded` -> mark payment `COMPLETED` + `paidAt` +
  trimmed `rawResponse`, then `markOrderAsPaid`; `payment_intent.payment_failed`
  -> mark `FAILED`.
- Handlers are **idempotent**: an already-`COMPLETED` payment is left untouched,
  so Stripe redelivery does not re-trigger the order transition
  (`payment.service.ts:240`).
- Admin oversight lists/views payments; customers see their own history/detail.

---

## 10. Cross-Cutting Concerns

### 10.1 Error Handling
`errors/AppError.ts` is the base for deliberate/operational errors
(`isOperational = true`) with typed subclasses for 400/401/403/404/409.
`error.middleware.ts` maps:
- `AppError` -> its `statusCode` + message.
- `ZodError` -> `400` with `err.flatten()`.
- Prisma known errors -> `P2002`->409, `P2025`->404, `P2003`->400, default 400.
- Unknown `Error` -> `500` (message only exposed in development).
- Server errors (>=500) are logged at `error`; others at `warn`.

Response shape on failure: `{ success: false, message, errorDetails }`.

### 10.2 Validation
`middlewares/validate.middleware.ts` parses `body`/`query`/`params` with a Zod
schema and replaces that part with the parsed result. Typed as `ZodTypeAny` so
schemas using `.refine()`/`.transform()` are accepted.

### 10.3 Authentication
`auth.middleware.ts` verifies the Bearer JWT, then re-fetches `{ id, role,
status }` from the database. This is what allows it to reject a user suspended
**after** the token was issued. Missing/invalid tokens and suspended users get
`401`. `req.user` is typed via `types/express.d.ts`.

### 10.4 Authorization
`role.middleware.ts`'s `verifyRole(...)` restricts a route to one or more roles
and must run after token verification. Ownership is enforced in the service
layer (e.g. `assertOwnership`, `getRentalByIdForUser`), not only by role.

### 10.5 Response Contract
Success (`utils/ApiResponse.ts`): `{ success: true, message, data, meta? }`.
Failure: `{ success: false, message, errorDetails }`.

### 10.6 Pagination
Offset pagination (`utils/pagination.ts`): `{ page, limit } -> { skip, take }` and
`meta: { page, limit, total, totalPages }`. `limit` is capped at 100 in every
query schema.

### 10.7 Logging & Lifecycle
Winston logger (colorized in dev, JSON in prod). `server.ts` handles graceful
shutdown and unhandled rejection/exception. `morgan` logs HTTP requests.

---

## 11. Business Workflows

### 11.1 End-to-end rental lifecycle

```
Register (CUSTOMER)
  -> Browse /api/gear  -> POST /api/rentals        (PLACED, stock reserved)
       -> PROVIDER PATCH /provider/orders/:id/status -> CONFIRMED
            -> CUSTOMER POST /api/payments/create    (Stripe PaymentIntent)
                 -> Stripe webhook succeeded        -> PAID
                      -> PROVIDER -> PICKED_UP
                           -> PROVIDER -> RETURNED  (stock restored)
                                -> CUSTOMER POST /api/reviews -> rating recalc
```

### 11.2 Rental status state machine (`constants/orderStatus.ts:25`)

```
PLACED     -> CONFIRMED | CANCELLED
CONFIRMED  -> PAID
PAID       -> PICKED_UP
PICKED_UP  -> RETURNED
RETURNED   -> (terminal)
CANCELLED  -> (terminal)
```

- `PROVIDER_SETTABLE_STATUSES = [CONFIRMED, PICKED_UP, RETURNED]`.
- `PAID` is set only by the Stripe webhook; `CANCELLED` only by the customer
  cancel endpoint (from `PLACED`).
- `assertValidTransition` throws `409 ConflictError` on any illegal jump.

### 11.3 Stock semantics

- **Reserved** on order creation (`rental.service.ts:71`).
- **Released** on `CANCELLED` (`cancelRentalOrder`) and on `RETURNED`
  (`updateOrderStatus`), each inside a transaction.
- `STOCK_RELEASING_STATUSES = [CANCELLED, RETURNED]` is defined in
  `constants/orderStatus.ts:53` but the releasing logic is inlined in the
  service rather than driven by this constant.

### 11.4 Payment lifecycle

`PENDING` (intent created) -> `COMPLETED` (webhook succeeded) or `FAILED`
(webhook failed). `REFUNDED` exists in the enum and migration but **no code path
ever sets it** (no refund endpoint).

---

## 12. Status Matrix

### 12.1 Implemented
| Area | Detail |
|---|---|
| Auth | register, login, me, update profile, change password, suspension enforcement |
| Gear | public browse, provider CRUD with ownership, admin listing |
| Rentals | create (atomic stock), list, detail, cancel, provider status transitions, admin oversight |
| Reviews | create (post-return), list for gear, transactional rating recalculation |
| Categories | public read, admin CRUD, delete guard |
| Users | admin list, suspend/activate with admin protection |
| Payments | Stripe PaymentIntent, signed webhook, idempotency, customer history, admin oversight |
| Infra | env validation, layered errors, Zod validation, JWT, logging, graceful shutdown |

### 12.2 Incomplete
| Area | Gap |
|---|---|
| SSLCommerz | enum/validation accept it; service returns "not supported" (`payment.service.ts:149`) |
| Reviews | no update/delete/moderation |
| Payments | `REFUNDED` status unused; no refund flow |
| Rentals | no date-range conflict detection (stock-only); deposits/late fees absent |
| Currency | hardcoded `usd` (`payment.service.ts:189`) |
| Availability | `isAvailable` and `stock` are independent/decoupled |

### 12.3 Missing (production SaaS)
Auth lifecycle (email verification, password reset, refresh tokens, logout),
rate limiting/brute-force protection, request IDs, audit logging, automated
tests, CI/CD, Docker, OpenAPI docs, observability/monitoring, background jobs,
caching, file/image upload, notifications/email, provider payouts/commission,
security deposits, refunds/disputes, tax/multi-currency, availability calendar,
in-app messaging, favorites, subscriptions, analytics, KYC/verification, soft
deletes, API versioning.

---

## 13. Verified Discrepancies & Bugs

Every item below was confirmed by reading the code (not inferred from the README).

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | High | README tells users to check `GET /api/health`, but no such route exists; only `GET /` is defined. | `app.ts:50`; `README.md:52` |
| 2 | High | CORS uses `origin: '*'` together with `credentials: true` — an invalid/unsafe combination that browsers reject for credentialed requests. | `app.ts:31`, `env.ts:15` |
| 3 | High | `z.coerce.boolean()` coerces the string `"false"` to `true` (JS `Boolean("false") === true`). | `env.ts:33`; also `gear.validation.ts:17,39` |
| 4 | Medium | README claims the Reviews module recalculates ratings on create/update/delete, but only `create` exists; no update/delete endpoints. | `review.service.ts:63`; `README.md:121,234` |
| 5 | Medium | README says stock is reduced "on order confirmation", but the code reduces stock on order **creation**. | `rental.service.ts:71`; `README.md:235` |
| 6 | Medium | `.env.example` is referenced by the README but does not exist. | repo root |
| 7 | Medium | Stripe currency is hardcoded to `usd`; no multi-currency support. | `payment.service.ts:189` |
| 8 | Medium | `PaymentStatus.REFUNDED` is defined but never set anywhere; no refund flow. | `schema.prisma:45`; payments module |
| 9 | Medium | `isAvailable` and `stock` are decoupled: a gear item can be `isAvailable = true` with `stock = 0`. | `schema.prisma:103`; `rental.service.ts:72` |
| 10 | Low | `SSLCOMMERZ` is accepted by the enum/validation but rejected at runtime with a 400. | `payment.service.ts:149` |
| 11 | Low | `STOCK_RELEASING_STATUSES` constant is defined but not used to drive release logic. | `orderStatus.ts:53` |
| 12 | Low | No automated tests, CI, Docker, or OpenAPI spec exist. | repo root |

---

## 14. Non-Functional Posture

| Dimension | Assessment |
|---|---|
| **Security** | Good foundations (helmet, bcrypt, JWT, DB re-fetch on auth, no PII in tokens, enumeration-safe login). Gaps: permissive CORS default, no rate limiting, no refresh/revocation, no email verification/reset, no request IDs, no audit log. |
| **Performance** | Sensible indexed queries, offset pagination, denormalized ratings, and a cached single Prisma client. No caching layer, no full-text search, no background processing. |
| **Scalability** | Stateless API is horizontally scalable behind a load balancer; stock race handled atomically at the DB. Offset pagination and lack of caching will degrade at large catalog/order volumes. |
| **Reliability** | Graceful shutdown, transactional multi-write operations, idempotent webhook. No retries/queue for webhook side effects, no health/readiness probes. |
| **Testability** | No tests exist; the layered structure (services isolated from HTTP) makes unit/integration testing straightforward to add. |
| **Observability** | Structured Winston logs only; no metrics, tracing, error tracking, or alerting. |
| **Data integrity** | Strong: `Decimal` money, price snapshots, FK restrict/cascade choices, unique constraints for one-payment/one-review invariants. |

---

## 15. Roadmap Summary

Directions agreed for evolving GearUp into a global, commission-based rental
marketplace SaaS (detailed phasing lives in `docs/PRD.md`):

1. **Phase 1 — Production hardening:** fix the discrepancies above; add automated
   tests (Testcontainers), CI/CD, Docker, OpenAPI; add auth lifecycle (refresh
   tokens, email verification, password reset) with Nodemailer/SMTP; rate
   limiting; request IDs; Sentry.
2. **Phase 2 — Rental/payment correctness:** date-aware availability and
   conflict detection, security deposits, refunds/cancellations, financial
   breakdown (tax/fees), idempotency keys, multi-currency.
3. **Phase 3 — Marketplace monetization:** Stripe Connect payouts, platform
   commission, provider ledger/earnings, admin revenue reporting.
4. **Phase 4 — SaaS revenue & scale:** provider subscription/featured listings,
   caching, background jobs, full-text search, analytics, image upload,
   notifications/messaging, favorites, KYC.

---

## 16. Appendix

### 16.1 Seed data (`prisma/seed.ts`)
- Admin user `admin@gearup.com` / `Admin@123` (upsert, re-runnable).
- Five categories: Cycling, Camping, Fitness, Water Sports, Winter Sports.
- Registered in `prisma.config.ts` so `prisma migrate reset` runs it.

### 16.2 Migration
Single init migration `20260709164337_init` creates all enums, tables, indexes,
and foreign keys in the current schema.

### 16.3 Environment variables
See Section 6 for the full table.

### 16.4 Route count
38 routes across 7 feature modules (auth, gear, rentals, reviews, categories,
users, payments) plus the root handler.
