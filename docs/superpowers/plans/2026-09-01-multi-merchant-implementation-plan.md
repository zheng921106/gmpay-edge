# GMPay Edge Multi-Merchant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert GMPay Edge into a shared-D1 multi-merchant gateway with automatic sandbox/production onboarding, multi-merchant memberships, scoped RBAC, and backward-compatible GMPay/EPay APIs.

**Architecture:** Add merchants, environments, and memberships as the authoritative scope model. API requests derive immutable scope from the API key; authenticated UI requests use a validated signed context cookie. Merchant-owned records are scoped by merchant and environment, while capability catalogs and platform RBAC remain global.

**Tech Stack:** Bun, strict TypeScript, React 19, TanStack Start/Router/Query, Drizzle SQLite schema, Cloudflare D1/KV/R2/Queues/Cron, Better Auth, Zod, Vitest, Biome, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-01-multi-merchant-design.md` and `docs/superpowers/specs/2026-09-01-multi-merchant-design.zh-CN.md`

## Global Constraints

- Preserve GMPay and EPay API paths and request/response formats.
- Never trust a merchant identifier from a request body, query string, or client-only state.
- Every merchant-owned server function requires a validated merchant/environment context.
- Platform permissions and merchant permissions remain separate; client hiding never replaces server authorization.
- Store money as decimal integer strings and timestamps as milliseconds; do not add floating-point calculations.
- Do not store decrypted credentials, session tokens, API secrets, or private keys in cookies, KV, logs, or committed files.
- Use the existing Better Auth, RBAC, Drizzle, Paraglide, ProTable, and runtime adapter boundaries; do not add competing frameworks or generic pass-through layers.
- Migrations must be forward-compatible, preserve existing rows, and use the maintained Cloudflare/Bun migration paths.
- Run focused tests after each task and the final quality gate only on the final tree.

## File Map

- `src/db/schema/tenant.ts`: merchants, environments, memberships, and scoped-role relations.
- `src/db/schema/access.ts`: platform/merchant role scope changes and constraints.
- `src/db/schema/payments.ts`: merchant/environment columns and scoped indexes for payment resources.
- `src/db/schema/webhooks.ts`, `src/db/schema/telegram.ts`, `src/db/schema/settings.ts`: scoped child resources and platform/global boundaries.
- `src/db/schema/index.ts`: export tenant schema.
- `drizzle/0007_*.sql`, generated `drizzle/meta/*`: migration that creates scope rows, backfills legacy records, and adds indexes.
- `src/server/merchant-context.ts`: request-bound merchant/environment context and signed cookie helpers.
- `src/features/access/server/merchant-access.ts`: merchant membership and role evaluation.
- `src/features/auth/server/registration.ts`, `src/features/auth/server/session.ts`: automatic merchant onboarding and bootstrap data.
- `src/features/merchants/server/*`, `src/features/merchants/pages/*`: merchant creation, status, member, and environment administration.
- `src/features/api-keys/server/*`, `src/features/orders/server/*`, `src/features/checkout/server/*`, `src/features/payments/server/*`, `src/features/webhooks/server/*`, `src/features/telegram/server/*`: scope propagation.
- `src/layouts/components/*`, `src/routes/admin/*`, `src/routes/(auth)/sign-up.tsx`: context selectors and registration routes.
- `tests/unit/tenant/*`, `tests/integration/tenant/*`, `tests/security/tenant/*`, `tests/e2e/*`: isolation, migration, and workflow coverage.

---

### Task 1: Add Tenant Schema and Scope Types

**Files:**
- Create: `src/db/schema/tenant.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/db/schema/access.ts`
- Test: `tests/unit/tenant/schema-contract.test.ts`

**Interfaces:**
- Produce `merchantStatus = ["active", "suspended"]`, `environmentCodes = ["sandbox", "production"]`, and `environmentStatus` constants.
- Produce `merchantId`, `environmentId`, and `MerchantEnvironmentContext` TypeScript types used by later tasks.
- Produce Drizzle tables `merchants`, `merchantEnvironments`, and `merchantMemberships`.

- [ ] **Step 1: Write failing schema contract tests**

Assert that the tables expose IDs, merchant status, environment code/status, membership status, foreign keys, and unique merchant/environment and merchant/user pairs. Assert that the schema index exports all three tables.

- [ ] **Step 2: Run the focused test and verify failure**

Run `node_modules/.bin/vitest run tests/unit/tenant/schema-contract.test.ts` with the workspace Node runtime. Expected: FAIL because the tenant schema exports do not exist.

- [ ] **Step 3: Implement the Drizzle schema**

Define `merchants`, `merchant_environments`, and `merchant_memberships` with `timestamps`, explicit enum unions, status defaults, foreign keys, and indexes beginning with `merchant_id`. Add merchant-scoped role ownership columns to `roles` and update the role-name uniqueness contract to distinguish platform roles from merchant roles.

- [ ] **Step 4: Run schema tests and format touched files**

Run `node_modules/.bin/vitest run tests/unit/tenant/schema-contract.test.ts` and `node_modules/.bin/biome format --write src/db/schema/tenant.ts src/db/schema/access.ts src/db/schema/index.ts tests/unit/tenant/schema-contract.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/tenant.ts src/db/schema/access.ts src/db/schema/index.ts tests/unit/tenant/schema-contract.test.ts
git commit -m "feat: add merchant tenancy schema"
```

### Task 2: Create the Legacy Backfill Migration

**Files:**
- Create: `drizzle/0007_multi_merchant.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: generated `drizzle/meta/0007_snapshot.json`
- Test: `tests/integration/tenant/migration-backfill.test.ts`

**Interfaces:**
- Produce one idempotent migration that creates the default merchant, sandbox and production environments, and membership rows before application code requires scope.
- Preserve existing IDs and values; legacy API keys and orders must map to the default merchant production environment.

- [ ] **Step 1: Build a migration fixture and write failing backfill assertions**

Create a SQLite fixture with the current pre-migration tables and representative user, API key, receiving method, order, webhook, Telegram, and settings rows. Assert that applying the migration creates exactly one default merchant, two environments, and scoped legacy rows without deleting source IDs.

- [ ] **Step 2: Run the migration test and verify failure**

Run `node_modules/.bin/vitest run tests/integration/tenant/migration-backfill.test.ts`. Expected: FAIL because migration `0007_multi_merchant.sql` does not exist.

- [ ] **Step 3: Generate and implement the forward-compatible SQL migration**

Run `bun run db:generate` to produce the Drizzle metadata and initial SQL, then edit the generated `drizzle/0007_*.sql` with the explicit backfill statements. Create scope tables first, insert the default merchant with `INSERT OR IGNORE`, add scope columns as nullable, backfill all legacy rows to production, rebuild affected SQLite tables where required for composite constraints, create scoped indexes, and leave no nullable scope after backfill. Use deterministic migration-local IDs only for the generated default rows; never hand-edit generated snapshot JSON.

- [ ] **Step 4: Verify migration invariants**

Run the fixture test twice to prove the second application is a no-op. Check row counts, orphan counts, duplicate scoped keys, and `EXPLAIN QUERY PLAN` for order/API-key lookups. Expected: PASS with zero orphan rows and scope-leading indexes.

- [ ] **Step 5: Commit the migration**

```bash
git add drizzle/0007_multi_merchant.sql drizzle/meta tests/integration/tenant/migration-backfill.test.ts
git commit -m "feat: backfill legacy data into merchant scope"
```

### Task 3: Implement Request Merchant Context and Scoped RBAC

**Files:**
- Create: `src/server/merchant-context.ts`
- Create: `src/features/access/server/merchant-access.ts`
- Modify: `src/features/access/server/require-admin.ts`
- Modify: `src/features/auth/server/session.ts`
- Test: `tests/unit/tenant/merchant-context.test.ts`
- Test: `tests/security/tenant/merchant-access.test.ts`

**Interfaces:**
- Produce `type MerchantEnvironmentContext = { merchantId: string; environmentId: string; environment: "sandbox" | "production" }`.
- Produce `loadMerchantContext(request, access)` that validates a signed HttpOnly context cookie against membership and environment status.
- Produce `setMerchantContext(request, context)` and `clearMerchantContext(request)` using the existing trusted Origin/CSRF boundary.
- Produce `requireMerchantAccess(request, permission)` that combines platform permission, membership status, merchant role masks, and selected environment status.

- [ ] **Step 1: Write failing context and isolation tests**

Cover missing cookies, malformed signatures, suspended merchants, suspended environments, non-member users, platform administrator access, valid multi-merchant membership, and merchant role permission masks. Assert that a selected merchant changes data scope but not platform permission union.

- [ ] **Step 2: Run tests and verify failure**

Run `node_modules/.bin/vitest run tests/unit/tenant/merchant-context.test.ts tests/security/tenant/merchant-access.test.ts`. Expected: FAIL because context and merchant access helpers do not exist.

- [ ] **Step 3: Implement signed context and access evaluation**

Use a versioned, expiring HMAC-signed cookie containing only merchant/environment IDs and a nonce. Re-read authoritative membership and environment rows on each server entry point; deny database/parsing errors. Reuse existing `requireAdmin` and access-cache revision logic for platform permissions, then add merchant role evaluation without creating a second authentication system.

- [ ] **Step 4: Run focused tests and format**

Run both focused test files and `node_modules/.bin/biome format --write src/server/merchant-context.ts src/features/access/server/merchant-access.ts src/features/access/server/require-admin.ts src/features/auth/server/session.ts tests/unit/tenant/merchant-context.test.ts tests/security/tenant/merchant-access.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/merchant-context.ts src/features/access/server/merchant-access.ts src/features/access/server/require-admin.ts src/features/auth/server/session.ts tests/unit/tenant/merchant-context.test.ts tests/security/tenant/merchant-access.test.ts
git commit -m "feat: enforce merchant request context"
```

### Task 4: Add Automatic Registration and Merchant Administration

**Files:**
- Create: `src/routes/(auth)/sign-up.tsx`
- Create: `src/features/auth/server/registration.ts`
- Create: `src/features/merchants/server/admin.ts`
- Create: `src/features/merchants/pages/admin.tsx`
- Create: `src/features/merchants/pages/members.tsx`
- Modify: `src/routes/admin/route.tsx`
- Modify: `src/features/auth/error-message.ts`
- Modify: `messages/en-US.json`, `messages/ja-JP.json`, `messages/ko-KR.json`, `messages/ru-RU.json`, `messages/zh-TW.json`, `messages/zh-CN.json`
- Test: `tests/integration/tenant/registration.test.ts`
- Test: `tests/e2e/merchant-onboarding.spec.ts`

**Interfaces:**
- Produce `registerMerchant(input): Promise<{ merchantId: string; environmentIds: { sandbox: string; production: string } }>`.
- Produce `listMerchantsFn`, `createMerchantFn`, `setMerchantStatusFn`, `setEnvironmentStatusFn`, `listMerchantMembersFn`, and `setMerchantMemberRoleFn` with Zod validators and platform/merchant permissions.

- [ ] **Step 1: Write failing registration tests**

Assert that registration creates one Better Auth user, one merchant, two active environments, one owner membership, and seeded owner/admin/operator/viewer roles in one transaction; duplicate email/slug errors remain structured; both environments are immediately usable.

- [ ] **Step 2: Run registration tests and verify failure**

Run `node_modules/.bin/vitest run tests/integration/tenant/registration.test.ts`. Expected: FAIL because registration and merchant server functions do not exist.

- [ ] **Step 3: Implement the transactional registration flow**

Call the existing Better Auth credential creation path, then insert merchant, environments, roles, permissions, and owner membership in the same database transaction. Do not add an approval queue. Redirect to onboarding with a signed merchant context.

- [ ] **Step 4: Implement platform merchant and member pages**

Use existing ProTable/ProForm and Paraglide messages. Platform pages can create/suspend merchants; merchant owners can invite and role-bind members. Every mutation checks server permissions and writes an audit entry.

- [ ] **Step 5: Run focused tests, format, and commit**

Run the integration test and `node_modules/.bin/biome check 'src/routes/(auth)/sign-up.tsx' src/features/auth/server/registration.ts src/features/merchants tests/integration/tenant/registration.test.ts tests/e2e/merchant-onboarding.spec.ts`. Commit with `feat: add merchant registration and administration`.

### Task 5: Scope API Keys and GMPay/EPay Authentication

**Files:**
- Modify: `src/db/schema/payments.ts`
- Modify: `src/features/api-keys/server/gmpay-signature.ts`
- Modify: `src/features/api-keys/server/admin.ts`
- Modify: `src/features/api-keys/server/list.ts`
- Modify: `src/features/api-keys/server/enabled.ts`
- Modify: `src/features/api-keys/server/revoke.ts`
- Modify: `src/features/api-keys/server/rotate.ts`
- Modify: `src/features/api-keys/pages/admin.tsx`
- Test: `tests/security/tenant/api-key-scope.test.ts`
- Test: `tests/integration/api-keys.test.ts`

**Interfaces:**
- Extend the API principal to `{ apiKeyId, merchantId, environmentId, environment, pid, secret, scopes }`.
- Require `{ merchantId, environmentId }` in admin key create/list/mutate functions.

- [ ] **Step 1: Write failing scope tests**

Create sandbox and production keys for two merchants. Assert authentication returns the bound scope, disabled/suspended environments fail closed, and an API key cannot read or mutate another merchant's key or order.

- [ ] **Step 2: Run tests and verify failure**

Run `node_modules/.bin/vitest run tests/security/tenant/api-key-scope.test.ts tests/integration/api-keys.test.ts`. Expected: FAIL because API keys have no merchant/environment columns or principal scope.

- [ ] **Step 3: Implement scoped key storage and authentication**

Add columns, replace global admin list queries with scoped queries, keep PID globally unique, derive merchant/environment during signature authentication, and check merchant/environment status before rate limiting and returning the principal.

- [ ] **Step 4: Add environment-aware key UI**

Display environment badges, create keys only in the selected environment, and ensure mutation IDs are checked against the selected context server-side.

- [ ] **Step 5: Run tests and commit**

Run the focused tests plus `node_modules/.bin/biome check` on touched files. Commit with `feat: scope merchant api keys`.

### Task 6: Propagate Scope Through Orders, Checkout, Payments, and Idempotency

**Files:**
- Modify: `src/db/schema/payments.ts`
- Modify: `src/features/orders/server/gmpay-api.ts`
- Modify: `src/features/orders/server/create.ts`
- Modify: `src/features/orders/server/query.ts`
- Modify: `src/features/orders/server/admin.ts`
- Modify: `src/features/orders/server/admin-actions.ts`
- Modify: `src/features/checkout/server/checkout-order.ts`
- Modify: `src/features/checkout/server/functions.ts`
- Modify: `src/features/checkout/server/payment-options.ts`
- Modify: `src/features/payment-settings/server/*.ts`
- Modify: `src/features/payments/server/*.ts`
- Test: `tests/integration/tenant/order-isolation.test.ts`
- Test: `tests/security/tenant/order-isolation.test.ts`
- Test: `tests/integration/tenant/idempotency-isolation.test.ts`

**Interfaces:**
- Extend `OrderCreationContext` with required `merchantId`, `environmentId`, and `environment` for merchant API calls.
- Require `MerchantEnvironmentContext` in all merchant payment-setting and order service entry points.

- [ ] **Step 1: Write failing cross-scope order tests**

Create identical external order IDs in two merchants and both environments. Assert they coexist only within separate scopes, checkout lookup shows only the referenced order, payment options use the order's scope, and idempotency keys cannot replay across merchant/environment boundaries.

- [ ] **Step 2: Run tests and verify failure**

Run the three focused tenant test files. Expected: FAIL because current queries and unique indexes are global or API-key-only.

- [ ] **Step 3: Implement scoped order creation/query paths**

Pass the API principal scope from `gmpay-api.ts` into `createOrder`; add scope predicates to every order query and admin action; update idempotency key lookup and insert to use merchant/environment/key; retain opaque checkout URLs.

- [ ] **Step 4: Implement scoped receiving/payment configuration**

Add scope predicates to readiness, allocation locks, payment asset selection, rate adjustment lookup, payment ingestion, expiration, reconciliation, and status transitions. Child records must join through a scoped order rather than accepting an unverified ID.

- [ ] **Step 5: Run focused tests and commit**

Run tenant order/idempotency/security tests and the existing order/checkout/payment tests. Commit with `feat: isolate merchant orders and payments`.

### Task 7: Scope Webhooks, Telegram, Settings, and Background Jobs

**Files:**
- Modify: `src/db/schema/webhooks.ts`
- Modify: `src/db/schema/telegram.ts`
- Modify: `src/db/schema/settings.ts`
- Modify: `src/features/webhooks/server/*.ts`
- Modify: `src/features/telegram/server/*.ts`
- Modify: `src/features/settings/server/*.ts`
- Modify: `src/server/scheduled/*.ts`
- Modify: `src/features/operations/server/*.ts`
- Test: `tests/integration/tenant/webhook-isolation.test.ts`
- Test: `tests/security/tenant/background-job-scope.test.ts`

**Interfaces:**
- Queue payloads must include `{ merchantId, environmentId, resourceId }` for merchant-owned work.
- Webhook delivery and Telegram notification loaders must derive scope from stored order/merchant relations, not queue input alone.

- [ ] **Step 1: Write failing webhook/background isolation tests**

Queue two merchants' events together and assert each consumer processes only its own order, callback, Telegram binding, settings, and retry records. Assert a forged queue payload is rejected or resolves to the stored scope.

- [ ] **Step 2: Run tests and verify failure**

Run the focused webhook/background test files. Expected: FAIL because current queue and webhook queries are instance-global.

- [ ] **Step 3: Implement scope propagation**

Add scope columns or order joins to webhook/Telegram/settings records, update queue envelopes and consumers, keep platform command catalogs global, and add scope predicates to retention, reconciliation, and retry jobs.

- [ ] **Step 4: Verify callback and secret boundaries**

Assert callback URL validation, encrypted credential handling, audit redaction, and retry behavior are unchanged except for scope filtering. Run focused tests and `node_modules/.bin/biome check`.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/webhooks.ts src/db/schema/telegram.ts src/db/schema/settings.ts src/features/webhooks src/features/telegram src/features/settings src/server/scheduled src/features/operations tests/integration/tenant/webhook-isolation.test.ts tests/security/tenant/background-job-scope.test.ts
git commit -m "feat: isolate merchant webhooks and jobs"
```

### Task 8: Add Merchant and Environment Context UI

**Files:**
- Create: `src/layouts/components/merchant-switcher.tsx`
- Create: `src/layouts/components/environment-switcher.tsx`
- Modify: `src/layouts/components/header.tsx`
- Modify: `src/layouts/components/navigation-context.tsx`
- Modify: `src/routes/admin/route.tsx`
- Modify: existing merchant-owned admin pages under `src/features/*/pages`
- Test: `tests/unit/tenant/context-switcher.test.tsx`
- Test: `tests/e2e/merchant-switching.spec.ts`

**Interfaces:**
- Produce `listAccessibleMerchantsFn` and `setSelectedMerchantFn` with server validation.
- Produce `listAccessibleEnvironmentsFn` and `setSelectedEnvironmentFn` with server validation.

- [ ] **Step 1: Write failing UI and E2E tests**

Assert that a multi-member user sees only accessible merchants, switching updates the signed context, the environment switcher shows sandbox/production, and existing tables refresh using the selected scope.

- [ ] **Step 2: Run tests and verify failure**

Run `node_modules/.bin/vitest run tests/unit/tenant/context-switcher.test.tsx` and the targeted Playwright E2E test. Expected: FAIL because selectors and context functions do not exist.

- [ ] **Step 3: Implement accessible selectors**

Use existing header/navigation patterns, accessible names, keyboard focus restoration, responsive layout, Paraglide messages, and no query-parameter route simulation. On selection, call the server mutation and invalidate only scoped queries.

- [ ] **Step 4: Scope existing pages**

Update orders, payments, API keys, webhooks, Telegram, settings, and dashboard loaders to consume selected context and show the active merchant/environment in page headers.

- [ ] **Step 5: Run UI tests and commit**

Run the focused unit/E2E tests and format touched files. Commit with `feat: add merchant context selectors`.

### Task 9: Complete Isolation Coverage and Simplification Review

**Files:**
- Create or modify: `tests/security/tenant/*.test.ts`
- Create or modify: `tests/integration/tenant/*.test.ts`
- Modify: `docs/en-US/MERCHANT_API.md`
- Modify: `docs/zh-CN/MERCHANT_API.md`
- Modify: `docs/en-US/SECURITY.md`
- Modify: `docs/zh-CN/SECURITY.md`

**Interfaces:**
- Document API-key-selected sandbox/production behavior, merchant membership, registration, and context switching without exposing secrets.

- [ ] **Step 1: Run the full tenant matrix**

Run the tenant unit, integration, security, and E2E tests. Include platform admin cross-merchant reads, ordinary member denial, suspended environment denial, duplicate scoped IDs, webhook retries, and legacy single-merchant compatibility.

- [ ] **Step 2: Perform behavior-preserving simplification review**

Review the touched diff for duplicate scope parsing, pass-through wrappers, dead global queries, unused exports, and repeated permission checks. Remove only verified duplication within established module boundaries.

- [ ] **Step 3: Update paired documentation**

Document the stable endpoint behavior, environment selection by API key, registration flow, member roles, and migration implications in the existing English/Chinese docs.

- [ ] **Step 4: Run focused verification**

Run `bun run typecheck`, the focused tenant matrix, `bun run check`, and both production build commands with the repository-supported Bun/Node runtimes. Commit with `test: verify multi-merchant isolation`.

### Task 10: Rehearse Migration and Release to Cloudflare

**Files:**
- Modify only if required by verification: `scripts/build.ts`, `scripts/*`, `wrangler.jsonc`
- Evidence: ignored local migration/runtime evidence files only

**Interfaces:**
- Produce remote migration output showing no orphan/duplicate scope rows.
- Produce a deployed Worker version and live smoke evidence for registration, merchant switching, sandbox key, and production key isolation.

- [ ] **Step 1: Run local migration rehearsal**

Apply the migration to a copy of the current local database, export counts/checksums, and verify rollback by restoring the pre-migration copy through maintained Bun data-operation scripts.

- [ ] **Step 2: Run final quality gates on the final tree**

Run exactly:

```bash
bun run typecheck
bun run test
bun run check
bun run build
bun run build:bun
```

Record the known Cloudflare configuration assertion separately if it still expects a missing `database_id`; do not remove a real configured D1 ID to satisfy that stale assertion.

- [ ] **Step 3: Commit any final test/documentation corrections**

Run `git diff --check`, inspect `git status --short`, and commit only corrections required by final verification.

- [ ] **Step 4: Push and deploy**

Push `main` to `origin`, run `bun run predeploy` to apply the remote migration checks, then run `bun run deploy`. Record the Worker version ID and bindings.

- [ ] **Step 5: Verify production behavior**

Using the browser and signed-in session where required, register or use two test merchants, select sandbox/production, and verify that each API key can access only its own scoped orders and checkout data. Check production health, GitHub parity, and clean working tree before reporting completion.
