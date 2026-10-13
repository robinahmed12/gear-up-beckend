# GearUp — Product Requirements Document (PRD)

> **Product:** GearUp — Sports & Outdoor Gear Rental Marketplace (Backend / API Platform)
> **Document status:** Draft v1.0 — for review
> **Prepared by:** Senior Product Manager & SaaS Architect
> **Date:** 2026-10-13
> **Source of truth:** `docs/PROJECT_ANALYSIS.md` (verified against `src/**`, `prisma/schema.prisma`, migrations, and root config)

---

## 0. Document Control

| Item | Value |
|---|---|
| Product name | GearUp |
| Platform scope | Backend API / platform services |
| Business model | Two-sided rental **marketplace**, monetized by **platform commission** (Stripe Connect), launching in the **US / global** market |
| Current maturity | Functional MVP backend; not yet production-ready |
| Delivery horizon | Phased (Phase 0–4) |
| Related docs | `docs/PROJECT_ANALYSIS.md`, `README.md` |

**Status legend used throughout this PRD**

| Tag | Meaning |
|---|---|
| **EXISTING** | Implemented and verified working in the current codebase |
| **PARTIAL** | Present but incomplete, stubbed, buggy, or mis-documented |
| **PROPOSED** | Recommended new capability, not yet built |

**Priority legend**

| Priority | Meaning |
|---|---|
| **P0** | Launch blocker — required for a safe, correct, compliant production release |
| **P1** | High-value core marketplace capability |
| **P2** | Valuable differentiator / efficiency improvement |
| **P3** | Nice-to-have / future |

---

## 1. Product Overview

### 1.1 Summary

GearUp is a **two-sided marketplace** that connects people who own sports and
outdoor gear (**Providers**) with people who want to rent it (**Customers**),
overseen by a platform operator (**Admins**). The backend today is a modular
Express + TypeScript API backed by PostgreSQL (Prisma 7), with JWT auth, a
role-scoped API surface, a rental order state machine, and Stripe payment
intake.

The near-term goal is to evolve this functional MVP into a **production-ready
SaaS marketplace**: trustworthy accounts, reliable bookings, safe payments with
refunds and deposits, provider payouts with platform commission, and the
operational tooling (observability, testing, admin controls) required to run a
commercial service.

### 1.2 Business Model (target)

- **Primary revenue:** platform **commission** on each completed rental
  (percentage of the booking total), collected via **Stripe Connect** destination
  charges and settled to providers through payouts.
- **Secondary revenue (later):** provider **subscription tiers** and **featured
  listing** placements.
- **Market/currency:** US-first, USD initially, with a path to multi-currency and
  sales tax via Stripe Tax.

### 1.3 Goals

1. Make the platform **safe and correct** enough to transact real money.
2. Give providers a reason to list and stay (payouts, earnings visibility, tools).
3. Give customers a trustworthy experience (verified accounts, real availability,
   reviews, transparent pricing, refunds).
4. Make the platform **operable** (observability, tests, CI/CD, admin tooling).
5. Build a clear path to **recurring and transaction revenue**.

### 1.4 Non-Goals (explicitly out of scope for this PRD horizon)

- Native mobile applications (the API should support them, but apps are not built here).
- Physical logistics / shipping integration (pickup-centric model assumed).
- Building a custom payment gateway (Stripe is the processor; SSLCommerz remains
  geographically optional and is not a launch dependency for the US/global market).
- Full ERP/accounting system (a payout ledger is in scope; general ledger is not).

### 1.5 Current Position (verified)

The backend exposes **38 routes across 7 modules** (auth, gear, rentals, reviews,
categories, users, payments). Core rental flow works end-to-end at a basic level:
browse gear -> place order (atomic stock reserve) -> provider confirms -> Stripe
PaymentIntent -> webhook marks order `PAID` -> pickup -> returned -> review.
**Not yet present:** production hardening (tests/CI/observability), account
lifecycle (verification, reset, refresh tokens), refunds/deposits/payouts, and
date-aware availability. Full detail in `docs/PROJECT_ANALYSIS.md`.

---

## 2. Target Users & Personas

### 2.1 Customer (Renter) — `Role: CUSTOMER`

People who need gear for a limited period without buying it.

> **Primary persona — "Weekend Adventurer":** wants to find available gear for
> specific dates, see trustworthy reviews, pay securely, and know they can cancel
> or get a refund under clear terms.

Needs: verified availability, transparent total price (fees/deposit/tax),
secure checkout, clear cancellation/refund policy, order status tracking,
ability to review.

### 2.2 Provider (Gear Owner / Rental Business) — `Role: PROVIDER`

Individuals or small businesses with idle gear inventory.

> **Primary persona — "Local Rental Shop":** wants to list gear, control
> availability and pricing, receive and manage booking requests, and get paid
> reliably and on time.

Needs: easy listing management, calendar/availability control, order fulfillment
workflow, visibility into earnings, predictable payouts, low fraud/damage risk.

### 2.3 Admin (Platform Operator) — `Role: ADMIN`

Platform staff operating the marketplace.

> **Primary persona — "Marketplace Ops / Trust & Safety":** needs to moderate
> listings and accounts, resolve disputes, monitor transactions, and keep both
> sides of the marketplace healthy.

Needs: oversight of users/gear/orders/payments, ability to suspend actors,
dispute/refund handling, reporting, and an audit trail of their own actions.

### 2.4 Secondary actors

- **Finance/Ops:** reconciles payouts and revenue (consumes admin reports/ledger).
- **Support:** assists customers/providers with bookings and disputes.

---

## 3. Core Workflows

### 3.1 Customer rental journey (target end-state)

```
Discover -> Register/Verify -> Browse & filter by DATE availability
   -> View gear + reviews + total price (rental + fees + deposit + tax)
   -> Book (instant or request) -> Pay (PaymentIntent / deposit hold)
   -> Order tracking (CONFIRMED -> PAID -> PICKED_UP -> RETURNED)
   -> Return gear -> Deposit released -> Refund (if applicable)
   -> Leave review
```

### 3.2 Provider fulfillment journey

```
Onboard + verify (KYC) -> Connect payout account
   -> List gear + set price/stock/unavailability blocks
   -> Receive booking -> Confirm -> Hand over (PICKED_UP)
   -> Receive return (RETURNED) -> Report damage/late (if any)
   -> Earn payout (net of commission) -> Track earnings
```

### 3.3 Money workflow (target)

```
Customer pays (Stripe PaymentIntent)
   -> Platform holds funds; commission computed
   -> Deposit authorized/held separately (manual capture)
   -> On successful return: release/void deposit; charge late/damage fees if any
   -> On cancellation/refund: issue refund per policy
   -> Payout to provider (net) via Stripe Connect, on payout schedule
   -> Admin can view revenue, refunds, and payout ledger
```

### 3.4 Admin moderation & oversight

```
View/filter users, gear, orders, payments
   -> Suspend/activate users; moderate/remove listings
   -> Handle disputes: refunds, penalties, notes
   -> Verify providers (KYC)
   -> Audit log of every privileged action
```

---

## 4. Current Feature Inventory & Status

Verified against the codebase. "Existing" means implemented and working;
"Partial" means present but incomplete/stubbed/buggy/mis-documented (see
`docs/PROJECT_ANALYSIS.md` Section 13 for evidence).

### 4.1 Implemented (EXISTING)

| # | Capability | Module / Evidence |
|---|---|---|
| E1 | Register as CUSTOMER/PROVIDER (email + password, bcrypt) | `auth.service.ts:25` |
| E2 | Login (enumeration-safe), returns JWT (`id`, `role`) | `auth.service.ts:50` |
| E3 | Current user profile (`GET /me`) | `auth.service.ts:75` |
| E4 | Update profile (name/phone) | `auth.service.ts:88` |
| E5 | Change password (verifies current) | `auth.service.ts:102` |
| E6 | Suspension enforced on every authenticated request | `auth.middleware.ts:40` |
| E7 | Public gear browse: search/filter/sort/paginate | `gear.service.ts:98` |
| E8 | Public gear detail | `gear.service.ts:119` |
| E9 | Provider gear CRUD (ownership-enforced 404/403) | `gear.service.ts:165` |
| E10 | Admin gear listing (incl. unavailable, by provider) | `gear.service.ts:240` |
| E11 | Create rental order with atomic stock reservation | `rental.service.ts:46` |
| E12 | Customer order list/detail; cancel from `PLACED` | `rental.service.ts:99,181,281` |
| E13 | Provider incoming orders + status transitions | `rental.service.ts:123,204` |
| E14 | Rental status state machine (guarded transitions) | `constants/orderStatus.ts:25` |
| E15 | Create review (post-`RETURNED`), denormalized rating recalc | `review.service.ts:63,32` |
| E16 | List reviews for a gear item | `review.service.ts:111` |
| E17 | Category public read + admin CRUD with delete guard | `category.service.ts` |
| E18 | Admin user list + suspend/activate (admin-protected) | `user.service.ts:74` |
| E19 | Stripe PaymentIntent creation for `CONFIRMED` orders | `payment.service.ts:148` |
| E20 | Stripe webhook (signature-verified, idempotent) -> order `PAID` | `payment.webhook.ts`, `payment.service.ts:240` |
| E21 | Customer payment history/detail; admin payment oversight | `payment.service.ts` |
| E22 | Admin rental oversight (all orders) | `rental.service.ts:152` |
| E23 | Env validation, layered errors, Zod validation, pagination, logging, graceful shutdown | `config/`, `errors/`, `utils/` |

### 4.2 Incomplete / Partial (PARTIAL)

| # | Capability | Gap | Priority to resolve |
|---|---|---|---|
| P1 | SSLCommerz payment method | Enum/validation accept it; runtime returns "not supported" (`payment.service.ts:149`) | P3 (optional) |
| P2 | Review lifecycle | No update/delete/moderation despite README claims | P1 |
| P3 | Refunds | `PaymentStatus.REFUNDED` never set; no refund flow | P0/P1 |
| P4 | Date-aware availability | Stock-only; no overlap/conflict detection | P0/P1 |
| P5 | Deposits / late / damage fees | Not modeled | P1 |
| P6 | Currency | Hardcoded `usd` (`payment.service.ts:189`) | P1 |
| P7 | Availability integrity | `isAvailable` and `stock` are decoupled | P1 |
| P8 | Health checks | README references `/api/health`; only `GET /` exists | P0 |
| P9 | CORS config | `origin: '*'` with `credentials: true` (invalid) | P0 |
| P10 | Boolean env parsing | `z.coerce.boolean()` treats `"false"` as `true` | P0 |
| P11 | Developer onboarding | `.env.example` referenced by README but missing | P0 |
| P12 | Documentation accuracy | README statements contradict code (health, stock timing, review lifecycle) | P0 |

### 4.3 Not Present (missing entirely)

No automated tests, CI/CD, Docker, OpenAPI/developer docs, observability/error
tracking, background jobs, caching, file/image upload, transactional email,
refresh tokens/logout, email verification, password reset, rate limiting,
audit logging, provider payouts/commission, subscriptions, messaging,
favorites, analytics, KYC, soft deletes, or API versioning.

---

## 5. Proposed SaaS Features (Realistic to This Product)

Grouped by theme. Each is **PROPOSED** unless noted. These build directly on the
existing rental-marketplace domain — no pivots.

### 5.1 Account, Identity & Trust

| Feature | Why it matters |
|---|---|
| Email verification | Prevents fake accounts; prerequisite for trust and notifications |
| Password reset / forgot password | Basic account recovery; launch expectation |
| Refresh tokens + session management + logout | Secure long-lived sessions without 7-day bearer tokens |
| Rate limiting & brute-force lockout | Protects auth and payment endpoints |
| MFA for ADMIN/PROVIDER | Protects high-value accounts |
| Provider KYC / identity verification | Trust, fraud reduction, compliance before payouts |
| Public provider profiles/storefronts | Discovery and credibility |

### 5.2 Booking, Availability & Rental Correctness

| Feature | Why it matters |
|---|---|
| Date-range availability calendar + conflict detection | Core correctness for a rental product; prevents double-booking |
| Availability blocks (maintenance/blackout dates) | Providers control when gear is rentable |
| Instant-book vs. request-to-book modes | Different provider risk appetites |
| Booking extensions / early return | Real-world rental operations |
| Multi-item cart / multi-gear orders | Larger baskets (P2/P3) |

### 5.3 Payments, Pricing & Monetization

| Feature | Why it matters |
|---|---|
| Provider payouts via Stripe Connect | Providers must get paid; enables marketplace |
| Platform commission (destination charges) | Primary revenue engine |
| Security deposits (hold/release) | Protects providers against damage/loss |
| Refunds & cancellation policy engine | Trust, dispute reduction, compliance |
| Late fees / damage fees | Recovers provider losses; line-item billing |
| Tax (Stripe Tax) | US sales-tax compliance |
| Invoices / receipts | Customer records, accounting |
| Multi-currency | Global expansion |
| Coupons / promo codes | Growth and demand stimulation |
| Provider subscription tiers / featured listings | Recurring revenue and upsell |
| Payout ledger & reconciliation | Financial integrity and ops |

### 5.4 Provider Tools

| Feature | Why it matters |
|---|---|
| Earnings dashboard | Retention; providers need payout visibility |
| Inventory + calendar management UI/API | Operational necessity |
| Provider analytics (views, conversion, utilization) | Helps providers optimize |
| Bulk listing operations | Efficiency at scale (P3) |

### 5.5 Trust, Safety & Reviews

| Feature | Why it matters |
|---|---|
| Reviews: edit/delete + moderation | Completes the review lifecycle; abuse control |
| Provider-side reviews (of customers) | Two-sided trust |
| Dispute resolution workflow | Handles damage/loss/no-show conflicts |
| Damage protection / insurance partnership | Risk transfer (P2) |
| Fraud & risk signals | Protect platform economics (P2) |

### 5.6 Platform Operations

| Feature | Why it matters |
|---|---|
| Audit logging of privileged actions | Accountability, compliance, forensics |
| Admin RBAC / granular permissions | Least privilege; team growth |
| Reporting & analytics dashboards | Run the business |
| Support tooling / internal notes | Efficient issue resolution |
| Feature flags / config management | Safe, incremental rollout |

### 5.7 Growth & Engagement

| Feature | Why it matters |
|---|---|
| Notifications (email/in-app; push later) | Order lifecycle communication |
| Customer–provider messaging | Pre/post-rental coordination (P2) |
| Favorites / wishlist | Re-engagement |
| Improved search + filters (full-text, geo) | Discovery and conversion |
| Referrals / loyalty | Growth (P3) |

### 5.8 Engineering & Operational Readiness (enablement, not user-facing)

Automated tests (unit + integration with Testcontainers), CI/CD, Docker +
deployment pipeline, OpenAPI/Swagger docs, structured error tracking (Sentry),
health/readiness probes, managed secrets, database backup/DR, staging
environment, and API versioning strategy. These are **required** to safely ship
everything above.

---

## 6. Functional Requirements

Requirements are grouped by domain. **Status** reflects whether the capability
already exists in some form. IDs are stable references for planning and QA.

### 6.1 Authentication & Account (AUTH)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| AUTH-1 | Users can register as CUSTOMER or PROVIDER with validated email/password | P0 | EXISTING |
| AUTH-2 | Users can log in and receive an access token | P0 | EXISTING |
| AUTH-3 | Suspended users are denied authenticated access | P0 | EXISTING |
| AUTH-4 | Access tokens are short-lived; a refresh token issues new access tokens | P0 | PROPOSED |
| AUTH-5 | Users can log out; refresh tokens can be revoked server-side | P0 | PROPOSED |
| AUTH-6 | Users must verify email before transacting (booking/listing) | P0 | PROPOSED |
| AUTH-7 | Users can request a password reset and set a new password via emailed token | P0 | PROPOSED |
| AUTH-8 | Auth and payment endpoints are rate-limited and lock out brute-force attempts | P0 | PROPOSED |
| AUTH-9 | Admins/Providers can enable MFA | P2 | PROPOSED |
| AUTH-10 | Users can update their own profile (name/phone) and change password | P1 | EXISTING |

### 6.2 Identity, Trust & Verification (IDV)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| IDV-1 | Providers complete KYC/identity verification before receiving payouts | P1 | PROPOSED |
| IDV-2 | Verified status is displayed on provider/gear listings | P1 | PROPOSED |
| IDV-3 | Public provider profile page (listings, rating, history) | P2 | PROPOSED |
| IDV-4 | Admins can manually verify/suspend providers with an audit trail | P1 | PARTIAL (suspend only) |

### 6.3 Gear Catalog & Listings (GEAR)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| GEAR-1 | Public searchable/filterable/sortable/paginated catalog | P1 | EXISTING |
| GEAR-2 | Providers can CRUD their own listings (ownership enforced) | P1 | EXISTING |
| GEAR-3 | Only listings that are both available and in stock are bookable | P1 | PARTIAL |
| GEAR-4 | Listings support multiple images uploaded to storage (not just URLs) | P1 | PROPOSED |
| GEAR-5 | Admins can moderate/hide/remove listings | P1 | PARTIAL (view only) |
| GEAR-6 | Listings support structured attributes (deposit, condition, pickup area) | P2 | PROPOSED |

### 6.4 Availability & Booking (AVAIL)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| AVAIL-1 | Availability is evaluated per date range, not just global stock | P0 | PROPOSED |
| AVAIL-2 | Overlapping bookings for the same unit are prevented (no double-booking) | P0 | PROPOSED |
| AVAIL-3 | Providers can block dates (maintenance/blackout) | P1 | PROPOSED |
| AVAIL-4 | Customers can view a calendar of open dates per listing | P1 | PROPOSED |
| AVAIL-5 | Providers choose instant-book or request-to-book | P2 | PROPOSED |
| AVAIL-6 | Bookings can be extended or shortened per policy | P3 | PROPOSED |

### 6.5 Rental Orders (RENT)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| RENT-1 | Customers can place a rental order with server-computed totals | P0 | EXISTING |
| RENT-2 | Order totals include rental subtotal, fees, deposit, and tax as line items | P1 | PROPOSED |
| RENT-3 | Order status follows the guarded state machine | P0 | EXISTING |
| RENT-4 | Providers can advance order status; invalid transitions are rejected | P0 | EXISTING |
| RENT-5 | Customers can cancel per policy (not only from `PLACED`) | P1 | PARTIAL |
| RENT-6 | Order creation is idempotent (safe retries) | P1 | PROPOSED |
| RENT-7 | Both parties receive order lifecycle notifications | P1 | PROPOSED |
| RENT-8 | Orders support multi-item line items | P3 | PROPOSED |

### 6.6 Payments, Pricing & Payouts (PAY)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| PAY-1 | Customers pay for a confirmed order via Stripe PaymentIntent | P0 | EXISTING |
| PAY-2 | Payment outcome is recorded only from a signed webhook (idempotent) | P0 | EXISTING |
| PAY-3 | Providers receive payouts net of commission via Stripe Connect | P1 | PROPOSED |
| PAY-4 | Platform commission is computed and recorded per order | P1 | PROPOSED |
| PAY-5 | Security deposits are authorized/held and released/voided | P1 | PROPOSED |
| PAY-6 | Refunds (full/partial) can be issued per cancellation policy | P0 | PROPOSED |
| PAY-7 | Late/damage fees can be charged as line items | P1 | PROPOSED |
| PAY-8 | Tax is calculated and recorded (Stripe Tax) | P1 | PROPOSED |
| PAY-9 | Customers receive invoices/receipts | P1 | PROPOSED |
| PAY-10 | Payments support multiple currencies | P2 | PROPOSED |
| PAY-11 | A ledger records commission, payouts, refunds, and adjustments | P1 | PROPOSED |
| PAY-12 | Coupons/promo codes apply discounts | P2 | PROPOSED |
| PAY-13 | Providers can subscribe to tiers / purchase featured listings | P2 | PROPOSED |

### 6.7 Reviews & Trust (REV)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| REV-1 | Customers can review gear after a returned order | P1 | EXISTING |
| REV-2 | Customers can edit/delete their own review; ratings recalculate | P1 | PARTIAL |
| REV-3 | Admins can moderate/hide abusive reviews | P1 | PROPOSED |
| REV-4 | Customers can review providers; providers can review customers | P2 | PROPOSED |
| REV-5 | Disputes (damage/loss/no-show) can be opened and resolved | P1 | PROPOSED |

### 6.8 Admin & Platform Operations (ADMIN)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| ADMIN-1 | Admins list/filter users and suspend/activate them (admin-protected) | P1 | EXISTING |
| ADMIN-2 | Admins manage categories | P1 | EXISTING |
| ADMIN-3 | Admins can view all gear, orders, and payments | P1 | EXISTING |
| ADMIN-4 | Every privileged/admin action is recorded in an audit log | P0 | PROPOSED |
| ADMIN-5 | Admins can issue refunds and apply penalties | P1 | PROPOSED |
| ADMIN-6 | Reporting/analytics dashboards (GMV, take rate, active users, utilization) | P1 | PROPOSED |
| ADMIN-7 | Granular admin roles/permissions | P2 | PROPOSED |
| ADMIN-8 | Feature flags / runtime configuration | P2 | PROPOSED |

### 6.9 Notifications & Engagement (NOTIF)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| NOTIF-1 | Transactional emails (verify, reset, booking, payment, payout) | P1 | PROPOSED |
| NOTIF-2 | In-app notifications feed | P2 | PROPOSED |
| NOTIF-3 | Customer–provider messaging | P2 | PROPOSED |
| NOTIF-4 | Favorites / wishlist | P2 | PROPOSED |
| NOTIF-5 | Push notifications (mobile) | P3 | PROPOSED |

### 6.10 Engineering Enablement (PLATFORM)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| PLATFORM-1 | Automated unit + integration tests (Testcontainers Postgres) | P0 | PROPOSED |
| PLATFORM-2 | CI/CD pipeline (lint, type-check, test, build, migrate) | P0 | PROPOSED |
| PLATFORM-3 | Containerized deployment (Dockerfile/docker-compose) | P0 | PROPOSED |
| PLATFORM-4 | Health (`/api/health`) and readiness (`/api/health/ready`) probes | P0 | PROPOSED |
| PLATFORM-5 | OpenAPI spec served at `/api/docs` | P1 | PROPOSED |
| PLATFORM-6 | Error tracking/monitoring (Sentry) + request IDs | P0 | PROPOSED |
| PLATFORM-7 | `.env.example` + documented configuration; managed secrets | P0 | PROPOSED |
| PLATFORM-8 | Database backup/restore strategy and staging environment | P1 | PROPOSED |
| PLATFORM-9 | API versioning strategy | P2 | PROPOSED |
| PLATFORM-10 | Background job processing (emails, webhooks, payouts) | P1 | PROPOSED |

---

## 7. Non-Functional Requirements

### 7.1 Performance

- **NFR-P1:** Read endpoints (catalog, order list) p95 latency < 300 ms at
  moderate load; write endpoints (booking, payment init) p95 < 800 ms excluding
  third-party payment latency.
- **NFR-P2:** Catalog pagination must remain efficient at 1M+ gear rows
  (keyset/cursor pagination where offset degrades).
- **NFR-P3:** Introduce a caching layer (Redis) for hot read paths and use
  background jobs for non-blocking work.

### 7.2 Scalability

- **NFR-S1:** The API remains stateless and horizontally scalable; no in-memory
  session state (refresh tokens persisted server-side).
- **NFR-S2:** Database connection pooling configured for the deployment target;
  read-heavy workloads can move to replicas.
- **NFR-S3:** High-contention booking paths must be safe under concurrency
  (retain/strengthen the atomic reservation pattern).

### 7.3 Reliability & Availability

- **NFR-R1:** Target 99.9% monthly API availability once launched.
- **NFR-R2:** All multi-write business operations must be transactional; payment
  webhooks must be idempotent and safe under redelivery.
- **NFR-R3:** Graceful shutdown and health/readiness probes must support
  zero-downtime deploys.
- **NFR-R4:** Documented backup/restore with a target RPO <= 24h and RTO <= 4h
  (to be refined with chosen infrastructure).

### 7.4 Security & Compliance

- **NFR-SEC1:** Passwords hashed with bcrypt (>= 12 rounds); no secrets in logs
  or source.
- **NFR-SEC2:** Strict CORS allowlist; credentials never combined with wildcard
  origin.
- **NFR-SEC3:** Rate limiting and lockout on auth/payment endpoints.
- **NFR-SEC4:** Short-lived access tokens with revocable refresh tokens.
- **NFR-SEC5:** Least-privilege authorization: role checks plus per-resource
  ownership checks in the service layer.
- **NFR-SEC6:** All admin/privileged actions audited.
- **NFR-SEC7:** PII minimized; data-retention and deletion (GDPR-style) support.
- **NFR-SEC8:** PCI scope minimized by delegating card handling to Stripe
  (no card data touches GearUp servers).

### 7.5 Observability

- **NFR-O1:** Structured JSON logs with correlation/request IDs.
- **NFR-O2:** Error tracking (Sentry) with environment/release tagging.
- **NFR-O3:** Core metrics: request rate/latency/error rate, booking success,
  payment success, webhook failures, payout status.

### 7.6 Maintainability

- **NFR-M1:** Consistent modular architecture (routes/controller/service/validation).
- **NFR-M2:** TypeScript `strict` maintained; lint/format enforced in CI.
- **NFR-M3:** New business logic covered by tests; migrations reviewed and
  reversible where feasible.

### 7.7 Accessibility & Internationalization

- **NFR-I1:** API responses support localization-ready fields (currency, locale)
  for future multi-currency/multi-region launch.
- **NFR-I2:** Documentation and error messages remain clear and consistent for
  client developers.

---

## 8. Security & Permissions

### 8.1 Authentication model (target)

- Access token: short-lived JWT (`id`, `role` only — no PII), re-validated
  against the DB on each request to enforce suspension.
- Refresh token: opaque, hashed, persisted server-side with expiry and
  revocation; rotated on use.
- Sessions: revocable (logout, admin force-logout, password change invalidates
  existing sessions).
- Account lifecycle: email verification required before transacting; password
  reset via single-use, expiring emailed tokens.
- Abuse protection: rate limiting on auth/payment endpoints; lockout after
  repeated failures.

### 8.2 Authorization model

Two-layer enforcement, both required:
1. **Role check** at the route (`verifyRole(...)`) — coarse-grained.
2. **Ownership/resource check** in the service layer — fine-grained
   (e.g., a provider may only manage their own gear; a customer may only see
   their own orders; admins bypass ownership where explicitly intended).

### 8.3 Permission Matrix (target state)

Legend: **Y** = allowed, **O** = allowed only for owned resources, **—** = denied.

| Capability | Customer | Provider | Admin |
|---|---|---|---|
| Browse public catalog / categories / reviews | Y | Y | Y |
| Manage own profile / password | Y | Y | Y |
| Create gear listings | — | Y | — |
| Manage (edit/delete) gear listings | — | O | Y |
| Block dates / manage availability | — | O | Y |
| Place rental orders | Y | — | — |
| Cancel own order (per policy) | O | — | Y |
| Advance order status (fulfill) | — | O | Y |
| Pay for an order | O | — | — |
| Request refund / open dispute | O | O | Y |
| Issue refund / apply penalty | — | — | Y |
| View own payments/earnings | O | O | Y |
| Suspend/activate users | — | — | Y |
| Moderate listings/reviews | — | — | Y |
| Verify providers (KYC) | — | — | Y |
| View platform-wide reports | — | — | Y |
| Manage categories | — | — | Y |
| View audit log | — | — | Y |

### 8.4 Current permissions (verified)

Existing enforcement today: role middleware + service-layer ownership checks
for gear (`assertOwnership`), rentals (`getRentalByIdForUser`), payments
(customer ownership), reviews (order ownership), and admin self-protection
(admins cannot suspend admins). Admin BYPASS of ownership is implemented for
order detail. This matrix is directional for the target state.

### 8.5 Data protection

- Least-privilege DB access; secrets in a managed store (never committed).
- Encrypt in transit (TLS) and at rest (managed DB encryption).
- PII minimization; audit log for privileged actions; retention policy and
  account/data deletion support.
- No card data stored; Stripe is the processor (minimal PCI scope).

---

## 9. Scalability & Reliability Requirements

### 9.1 Scalability requirements

| ID | Requirement |
|---|---|
| SCALE-1 | Stateless API instances behind a load balancer; sessions/tokens server-persisted |
| SCALE-2 | Configurable DB connection pool sized to the deployment tier |
| SCALE-3 | Cursor/keyset pagination for large collections (catalog, orders, audit) |
| SCALE-4 | Redis for caching and as the store for rate limiting / short-lived tokens |
| SCALE-5 | Background job queue for emails, webhook follow-ups, payouts, and reports |
| SCALE-6 | Read/write split path via replicas for analytics-heavy queries |
| SCALE-7 | File uploads offloaded to object storage (S3/Cloudinary), not the app server |

### 9.2 Reliability requirements

| ID | Requirement |
|---|---|
| REL-1 | Idempotency keys for order creation and payment operations |
| REL-2 | Idempotent, replay-safe Stripe webhook handling (retain existing behavior) |
| REL-3 | Transactional integrity for every multi-write operation (booking, refund, payout) |
| REL-4 | Retry with backoff for outbound calls (email, Stripe, storage); dead-letter queue for jobs |
| REL-5 | Health/readiness endpoints; zero-downtime rolling deploys |
| REL-6 | Automated backups + documented restore drill; staging environment for migration testing |
| REL-7 | Alerting on error rate, webhook failures, payout failures, and DB saturation |

---

## 10. Feature Priorities (P0–P3)

Prioritized by **business value vs. implementation complexity**. P0 is a launch
blocker; P3 is future.

### P0 — Launch blockers (correctness, safety, operability)

| Prel | Feature | Value | Complexity |
|---|---|---|---|
| P0-1 | Fix verified bugs/config (CORS, boolean coercion, `/api/health`, `.env.example`, README) | High | Low |
| P0-2 | Automated tests + CI/CD + Docker | High | Medium |
| P0-3 | Auth lifecycle: refresh tokens, logout, email verification, password reset | High | Medium |
| P0-4 | Rate limiting + request IDs + error tracking (Sentry) | High | Low/Medium |
| P0-5 | Date-aware availability & double-booking prevention | High | High |
| P0-6 | Refunds + cancellation policy engine | High | Medium/High |
| P0-7 | Audit logging of privileged actions | Medium/High | Low |
| P0-8 | OpenAPI docs + health/readiness probes | Medium | Low |

### P1 — Core marketplace value

| Prel | Feature | Value | Complexity |
|---|---|---|---|
| P1-1 | Stripe Connect payouts + platform commission | Very High | High |
| P1-2 | Security deposits (hold/release) + late/damage fees | High | High |
| P1-3 | Provider earnings dashboard + payout ledger | High | Medium |
| P1-4 | Availability blocks + calendar APIs | High | Medium |
| P1-5 | Tax (Stripe Tax) + invoices/receipts | High | Medium |
| P1-6 | Transactional email + notification service | High | Medium |
| P1-7 | Reviews: edit/delete + moderation; provider reviews | Medium | Medium |
| P1-8 | Provider KYC/verification | High | Medium |
| P1-9 | Dispute resolution workflow | Medium | High |
| P1-10 | Admin reporting/analytics | Medium | Medium |
| P1-11 | Image upload to object storage | Medium | Medium |
| P1-12 | Background job processing | Medium | Medium |

### P2 — Differentiators & efficiency

| Prel | Feature | Value | Complexity |
|---|---|---|---|
| P2-1 | Multi-currency | Medium | High |
| P2-2 | Coupons/promo codes | Medium | Low/Medium |
| P2-3 | Subscription tiers / featured listings | High (revenue) | High |
| P2-4 | Customer–provider messaging | Medium | Medium |
| P2-5 | Favorites/wishlist + in-app notifications | Medium | Medium |
| P2-6 | Full-text/geo search improvements | Medium | Medium |
| P2-7 | Admin RBAC (granular roles) | Medium | Medium |
| P2-8 | MFA | Medium | Low |
| P2-9 | Feature flags/config service | Low/Medium | Low |
| P2-10 | Damage protection / insurance partnership | Medium | High |

### P3 — Future / nice-to-have

| Prel | Feature | Value | Complexity |
|---|---|---|---|
| P3-1 | SSLCommerz (regional payments) | Low (US-first) | Medium |
| P3-2 | Multi-item cart | Medium | High |
| P3-3 | Booking extensions / early return | Low/Medium | Medium |
| P3-4 | Push notifications | Low | Medium |
| P3-5 | Referrals/loyalty | Low | Low/Medium |
| P3-6 | Public API/webhooks for partners | Medium | High |
| P3-7 | Bulk listing operations | Low | Low |

---

## 11. Phased Implementation Roadmap

Each phase has objectives, deliverables, and **acceptance criteria (AC)**. Phases
are sequential: later phases assume earlier ones are complete.

### Phase 0 — Stabilize & Correct

**Objective:** Remove known defects and documentation drift so the MVP is
trustworthy to build on.

**Deliverables**
- Fix CORS to an explicit allowlist (no wildcard + credentials).
- Fix boolean env parsing (`SSLCOMMERZ_IS_LIVE`, `isAvailable`).
- Add `GET /api/health` (and reserve readiness for Phase 1).
- Add `.env.example` with all variables.
- Correct README inaccuracies (health route, stock timing, review lifecycle).

**Acceptance criteria**
- [ ] No wildcard CORS when credentials are enabled; allowlist configurable.
- [ ] Setting a boolean env var to `"false"` yields `false`.
- [ ] `GET /api/health` returns `200` with status payload.
- [ ] `.env.example` exists and covers every variable in `config/env.ts`.
- [ ] README statements match verified behavior.

---

### Phase 1 — Production Hardening

**Objective:** Make the service safe, testable, observable, and deployable.

**Deliverables**
- **Testing:** Vitest + Supertest; Testcontainers Postgres; unit + integration
  coverage for auth, gear ownership, stock race (concurrent -> 409), order state
  machine, and Stripe webhook signature/idempotency.
- **CI/CD:** GitHub Actions (install, prisma generate, type-check, lint, test,
  build) with a Postgres service; migration deploy in the release step.
- **Containers:** multi-stage Dockerfile + docker-compose (api + postgres).
- **Auth lifecycle:** refresh tokens + rotation + logout/revocation; email
  verification; forgot/reset password; Nodemailer + SMTP.
- **Security:** rate limiting (auth/payment), request IDs, helmet/body-limit
  hardening, audit log for privileged actions.
- **Observability:** Sentry error tracking with environment/release tags;
  health + readiness probes.
- **Docs:** OpenAPI generated from Zod schemas, served at `/api/docs`.

**Acceptance criteria**
- [ ] CI is green and required on PRs; tests pass against a disposable Postgres.
- [ ] Integration test proves concurrent last-unit booking yields exactly one
      success and one `409`.
- [ ] Refresh-token rotation and revocation work; logout invalidates the session.
- [ ] Email verification and password reset work end-to-end via SMTP.
- [ ] Auth/payment endpoints return `429` under configured limits.
- [ ] Sentry captures errors with request IDs; `/api/health` and
      `/api/health/ready` respond correctly.
- [ ] Docker image builds and runs migrations; `/api/docs` serves the spec.
- [ ] Audit log records privileged admin actions.

---

### Phase 2 — Rental & Payment Correctness

**Objective:** Make bookings and money movement correct for a real rental
business.

**Deliverables**
- Date-aware availability engine + double-booking prevention + availability
  blocks and calendar APIs.
- Financial breakdown on orders (subtotal, fees, deposit, tax, total) and
  line items.
- Security deposits (authorize/hold + release/void) via Stripe manual capture.
- Refunds (full/partial) + cancellation policy engine; provider-cancel and
  admin-override paths.
- Late fees / damage fees as line items.
- Tax via Stripe Tax; invoices/receipts.
- Idempotency keys for order and payment creation.
- Currency made configurable (USD default).

**Acceptance criteria**
- [ ] Attempting two overlapping bookings of the same unit (insufficient stock
      for the dates) is rejected deterministically.
- [ ] A returned order releases the deposit; a damaged/late order can charge fees.
- [ ] Refunds are reflected in `PaymentStatus` and recorded (enum `REFUNDED`/
      partial states are actually used); a `charge.refunded` webhook is handled.
- [ ] Order/payment totals show tax and fees as separate line items.
- [ ] Retrying order/payment creation with the same idempotency key does not
      create duplicates.
- [ ] Currency is not hardcoded; USD remains the default.

---

### Phase 3 — Marketplace Monetization

**Objective:** Turn transactions into platform revenue and pay providers.

**Deliverables**
- Stripe Connect (Express) provider onboarding; destination charges with
  `application_fee_amount` as platform commission.
- Payout scheduling, payout records, and an immutable ledger for commission,
  refunds, and adjustments.
- Provider earnings dashboard APIs and payout status visibility.
- Provider KYC/verification gating payouts.
- Dispute resolution workflow (damage/loss/no-show).
- Admin revenue + payout reporting.

**Acceptance criteria**
- [ ] A completed booking results in commission recorded and a provider payout
      obligation in the ledger.
- [ ] Providers can view net earnings and payout status for their orders.
- [ ] Providers cannot receive payouts before KYC verification.
- [ ] Admin can resolve a dispute, issuing refund/penalty, with a full audit trail.
- [ ] Admin reports reconcile: GMV = provider payouts + platform commission
      (net of refunds).

---

### Phase 4 — Revenue Expansion & Scale

**Objective:** Add recurring revenue and platform scalability.

**Deliverables**
- Provider subscription tiers and featured listings (Stripe Billing).
- Transactional + in-app notifications; customer–provider messaging.
- Favorites/wishlist; improved full-text/geo search.
- Redis caching, background job queue, cursor pagination for large collections.
- Object-storage image uploads.
- Admin RBAC (granular roles) and feature flags.

**Acceptance criteria**
- [ ] Providers can subscribe/buy featured placement; billing state is correct.
- [ ] Notifications fire on key lifecycle events (booking, payment, payout).
- [ ] Search returns relevant results with acceptable latency at scale.
- [ ] Caching and background jobs are in use; hot paths meet NFR latency targets.
- [ ] Images upload to object storage and render on listings.
- [ ] Granular admin roles restrict capabilities per the permission matrix.

---

## 12. Success Metrics

| Category | Metric | Target direction |
|---|---|---|
| Demand | Monthly active customers; booking conversion rate | Up |
| Supply | Active listings; listing fill/utilisation rate | Up |
| Marketplace | GMV; take rate (commission %) | Up |
| Reliability | Payment success rate; webhook failure rate | Up / Down |
| Trust | Dispute rate; refund rate; review coverage | Down / Up |
| Provider health | Time-to-first-payout; provider retention | Down / Up |
| Engineering | p95 latency; error rate; test coverage | Down / Up |

---

## 13. Risks, Assumptions & Open Questions

### 13.1 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Double-booking / availability bugs | High | Phase 2 availability engine + concurrency tests |
| Payment/refund/payout errors | High | Idempotency, ledger, transactional integrity, Stripe integration tests |
| Fraud, damage, theft, no-shows | High | KYC, deposits, damage fees, dispute workflow, risk signals |
| Tax/regulatory non-compliance (US) | High | Stripe Tax, legal review, clear terms |
| Payout compliance (Connect requirements) | Medium/High | Use Stripe Express onboarding; verify before payouts |
| Reliability/scale issues | Medium | Tests, CI/CD, caching, jobs, monitoring (Phase 1) |
| Security breach / account takeover | High | Rate limiting, refresh rotation, MFA, audit logging |
| Supply/demand cold start (liquidity) | Medium | Featured listings, provider incentives, launch by category/geo |
| Scope creep | Medium | Strict phased roadmap; P0-P3 prioritization |
| Documentation drift | Low/Medium | Treat docs as code; review on changes |

### 13.2 Assumptions

- Launch market is **US/global** with **USD** first; SSLCommerz is optional/later.
- Stripe (Payments + Connect + Tax + Billing) is the payment/commerce backbone.
- Pickup-centric fulfilment; no shipping/logistics integration in this horizon.
- Providers own their inventory; the platform is an intermediary, not a lessor.
- A single backend API serves web (and future mobile) clients.
- Existing architecture (Express + Prisma + PostgreSQL) is retained and extended,
  not rewritten.

### 13.3 Open Questions (need decisions before/within Phase 2-3)

1. **Commission rate:** flat % or category-tiered? Any provider-specific rates?
2. **Cancellation policy:** default windows/penalties; per-provider overrides?
3. **Deposits:** authorize-and-hold (void on return) vs. charge-and-refund?
   Fixed amount, percentage, or per-listing?
4. **Payout cadence:** daily/weekly/manual; instant payouts offered?
5. **KYC provider:** Stripe Identity vs. third-party?
6. **Tax scope:** who is merchant of record; which states have nexus at launch?
7. **Dispute SLA:** who arbitrates, time windows, evidence requirements?
8. **Admin roles:** how many tiers, and who can issue refunds/penalties?
9. **Listing model:** single-unit vs. multi-unit inventory per listing?
10. **Multi-currency timing:** launch USD-only or support a currency set from day one?
11. **Observability budget:** Sentry-only vs. add tracing/metrics later?
12. **Notification channels at launch:** email only vs. email + in-app?

---

## 14. Out of Scope (this PRD horizon)

- Native mobile apps and web front-ends (this is the backend/product requirements).
- Custom payment gateway or card processing (delegated to Stripe).
- Shipping/logistics and insurance underwriting (partnership may be integrated later).
- Full accounting/ERP; only a marketplace payout ledger is in scope.
- Data warehouse/BI platform (dashboards only).

---

## 15. Appendix

### 15.1 Requirement-to-Code Traceability (existing features)

| Feature | Primary code reference |
|---|---|
| Register / login / profile / password | `src/modules/auth/` |
| Gear browse + provider CRUD | `src/modules/gear/` |
| Rentals + state machine + stock | `src/modules/rentals/`, `src/constants/orderStatus.ts` |
| Reviews + rating recalc | `src/modules/reviews/` |
| Categories | `src/modules/categories/` |
| Users (admin) | `src/modules/users/` |
| Payments (Stripe intent + webhook) | `src/modules/payments/` |
| Auth/role middleware | `src/middlewares/` |
| Schema/models/enums | `prisma/schema.prisma` |
| Verified gaps & bugs | `docs/PROJECT_ANALYSIS.md` Section 13 |

### 15.2 Glossary

| Term | Meaning |
|---|---|
| **Provider** | Gear owner/business listing inventory (`Role.PROVIDER`) |
| **Customer** | Renter placing bookings (`Role.CUSTOMER`) |
| **Admin** | Platform operator (`Role.ADMIN`) |
| **GMV** | Gross Merchandise Value — total booking value transacted |
| **Take rate** | Platform commission as a % of GMV |
| **Deposit** | Refundable security amount held against damage/loss |
| **Payout** | Funds transferred to a provider (net of commission) |
| **Commission** | Platform fee retained per booking |
| **KYC** | Know Your Customer identity verification |

### 15.3 Change Log

| Version | Date | Notes |
|---|---|---|
| 1.0 | 2026-10-13 | Initial PRD derived from verified `PROJECT_ANALYSIS.md` |

---

> **No code, schema, or migrations are changed by this document.** All features
> above are proposals pending approval. Implementation begins only after
> explicit sign-off on phase scope and the open questions in Section 13.3.
