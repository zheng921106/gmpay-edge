# GMPay Edge Payment Test Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an authenticated, environment-aware payment test center that can create GMPay and EPay orders through the real merchant protocol handlers, complete sandbox simulator or configured testnet payments through the real payment state machine, prove Webhook acknowledgement, and safely initiate confirmed production orders.

**Architecture:** Add a persisted `payment_test_run` aggregate inside the existing payment and Webhook ownership boundaries. Server-side orchestration builds and signs a real protocol `Request`, invokes the existing GMPay/EPay handler, then composes existing order, payment, audit, Webhook, and callback records into one timeline. Sandbox simulator events implement the existing `PaymentAdapter`/`NormalizedTransaction` contract; production never accepts simulator operations. Routes remain thin and mount one colocated `payment-testing` feature.

**Tech Stack:** Bun, strict TypeScript, React 19, TanStack Start/Router/Query/Form/Table, Tailwind CSS 4, shadcn/Radix, Zod, Better Auth, Drizzle, Cloudflare Workers D1/KV/R2/Queues/Cron, Bun/SQLite, Paraglide, Vitest, Biome, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-01-payment-test-center-design.md` and `docs/superpowers/specs/2026-09-01-payment-test-center-design.zh-CN.md`

## Global Constraints

- Preserve the existing GMPay and EPay public API paths, payloads, signatures, order service, state machine, Webhook outbox, retry policy, and checkout behavior.
- Every test operation resolves the authenticated merchant/environment context server-side. A submitted run, order, API key, receiving method, or callback ID is re-scoped before use.
- Sandbox accepts only `simulated` and `testnet` rails. Production accepts only `mainnet` rails. Production simulator calls fail before database or Queue mutation.
- API secrets are decrypted only while building/signing the protocol request. They never enter response payloads, test snapshots, KV, audit data, or logs.
- Simulator scenarios emit typed `NormalizedTransaction` observations through `recordPaymentTransaction`; they never write order status directly.
- Testnet and production receiving targets remain merchant-supplied public addresses. Never generate or store a private key, seed phrase, or withdrawal credential.
- Use integer-string money units, millisecond timestamps, bounded JSON snapshots, structured domain errors, and scope-leading indexes.
- Use existing Better Auth, merchant RBAC, Drizzle, ProForm, ProTable, Paraglide, navigation authority, runtime adapters, and design tokens. Do not add a second framework or generic service layer.
- Add all user-visible text to `en-US`, `ja-JP`, `ko-KR`, `ru-RU`, `zh-TW`, and `zh-CN` before UI verification.
- After each non-trivial task, review the touched diff for behavior-preserving simplification. Run the full quality gate once, only after all implementation tasks are complete.

## Authoritative Contracts

```ts
export const paymentNetworkClasses = ["mainnet", "testnet", "simulated"] as const;
export const paymentTestProtocols = ["gmpay", "epay"] as const;
export const paymentTestModes = ["simulator", "testnet", "live"] as const;
export const paymentTestStatuses = [
  "ready",
  "running",
  "passed",
  "failed",
  "cancelled",
  "expired",
] as const;
export const paymentTestCallbackModes = ["builtin", "custom"] as const;

export type PaymentTestExpectedOutcome =
  | "paid"
  | "partial"
  | "overpaid"
  | "failed_payment"
  | "late_payment"
  | "reorg_recovered"
  | "callback_retry_succeeded";
```

`payment_mode` maps to rail class as follows: `simulator -> simulated`, `testnet -> testnet`, `live -> mainnet`. The environment check and this mapping are one shared pure function used by preflight, receiving-method readiness, scenario execution, and production confirmation.

## File Map

- `src/db/schema/payments.ts`: rail network class and `paymentTestRuns`.
- `src/db/schema/webhooks.ts`: `paymentTestCallbackReceipts` and callback-attempt correlation.
- `drizzle/0011_payment_test_center.sql`, `drizzle/meta/_journal.json`: forward migration and catalog/bootstrap backfill.
- `src/features/payment-testing/schema.ts`, `types.ts`: Zod boundaries and stable feature contracts.
- `src/features/payment-testing/server/{preflight,protocol-request,runs,confirmation,simulator,callback,timeline,functions}.ts`: feature orchestration.
- `src/integrations/chains/simulator.ts`: runtime simulator adapter using existing chain types.
- `src/features/payment-settings/{catalog,readiness}.ts` and `server/{check-method-readiness,method-adapter}.ts`: network-class catalog and readiness enforcement.
- `src/features/auth/server/registration.ts`, `src/features/merchants/server/{platform,payment-ingresses}.ts`: atomic sandbox bootstrap for new merchants.
- `src/features/payment-testing/pages/*`: guided test, API console, history, and run detail.
- `src/routes/admin/test-center/*`, `src/routes/api/test-callbacks/$token.ts`: thin semantic routes.
- `src/layouts/components/data/sidebar-data.ts`: shared navigation and access mapping.
- `messages/*.json`: six-locale copy.
- `tests/{unit,integration,security,e2e}/payment-testing/*`: contract, isolation, workflow, theme, and runtime coverage.
- `docs/PAYMENT_TESTING.md`, `docs/PAYMENT_TESTING.zh-CN.md`: operator and merchant documentation.

---

### Task 1: Add Persistence, Indexes, and the Forward Migration

**Files:**
- Modify: `src/db/schema/payments.ts`
- Modify: `src/db/schema/webhooks.ts`
- Create: `drizzle/0011_payment_test_center.sql`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/unit/payment-testing/schema-contract.test.ts`
- Test: `tests/integration/payment-testing/migration.test.ts`
- Modify: `tests/integration/query-plans.test.ts`

**Interfaces:**
- Add non-null `payment_rails.network_class` with `mainnet` as the legacy-row migration value.
- Add `payment_test_runs` with scoped idempotency, nullable unique order association, redacted snapshots, production confirmation nonce state, callback-token hash state, result state, and timestamps.
- Add `payment_test_callback_receipts` with run/event/delivery/attempt identity, signature result, bounded redacted request evidence, acknowledgement, and timestamps.

- [ ] **Step 1: Write failing schema and migration tests**

Assert exact enum fields, foreign keys, check constraints, partial unique order index, `(merchant_id, environment_id, created_at, id)` history index, active-run index, and `(delivery_id, attempt)` callback uniqueness. Apply every migration to a fresh fixture and to a fixture containing legacy rails/orders; assert legacy rails become `mainnet`, no production record changes identity, and applying the migration registry twice creates no duplicate bootstrap data.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
bunx vitest run tests/unit/payment-testing/schema-contract.test.ts tests/integration/payment-testing/migration.test.ts
```

Expected: FAIL because `paymentRails.networkClass`, `paymentTestRuns`, `paymentTestCallbackReceipts`, and migration `0011_payment_test_center.sql` do not exist.

- [ ] **Step 3: Implement the Drizzle schema**

Use bounded JSON types rather than untyped strings:

```ts
export type RedactedProtocolSnapshot = {
  version: 1;
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
  status?: number;
  durationMs?: number;
};
```

The run unique key is `(merchant_id, environment_id, protocol, api_key_id, idempotency_key)`. `order_id` is unique only when non-null. Store only `callback_destination_snapshot`; store the raw custom URL on the order through the existing validated notify URL contract. Store SHA-256 hashes for production confirmation and built-in callback tokens, never raw tokens.

- [ ] **Step 4: Write migration `0011_payment_test_center.sql`**

Rebuild `payment_rails` only if SQLite requires it for the new non-null/check constraint; preserve all codes and timestamps. Create both tables and indexes and seed the simulator/testnet global catalog rows defined in Task 2 with `INSERT OR IGNORE`. SQL must not fabricate encrypted API-key secrets. Existing-merchant API keys and receiving resources are filled by the idempotent runtime reconciliation in Task 3 after the schema migration. Verify orphan/duplicate queries return zero, then execute `PRAGMA optimize`. Update only `_journal.json`; do not invent a snapshot that Drizzle did not generate.

- [ ] **Step 5: Verify schema, migration, and query plans**

Run:

```bash
bunx vitest run tests/unit/payment-testing/schema-contract.test.ts tests/integration/payment-testing/migration.test.ts tests/integration/query-plans.test.ts
bunx biome check src/db/schema/payments.ts src/db/schema/webhooks.ts tests/unit/payment-testing/schema-contract.test.ts tests/integration/payment-testing/migration.test.ts tests/integration/query-plans.test.ts
git diff --check
```

Expected: PASS; query plans use the scope-leading history and active-run indexes; no orphan or duplicate rows.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/payments.ts src/db/schema/webhooks.ts drizzle/0011_payment_test_center.sql drizzle/meta/_journal.json tests/unit/payment-testing/schema-contract.test.ts tests/integration/payment-testing/migration.test.ts tests/integration/query-plans.test.ts
git commit -m "feat: add payment test run persistence"
```

### Task 2: Enforce Rail Network Classes and Add First-Release Testnets

**Files:**
- Modify: `src/features/payment-settings/catalog.ts`
- Modify: `src/features/payment-settings/readiness.ts`
- Modify: `src/features/payment-settings/server/check-method-readiness.ts`
- Modify: `src/features/payment-settings/server/method-adapter.ts`
- Modify: `src/integrations/chains/types.ts`
- Modify: `src/integrations/chains/evm.ts`
- Modify: `src/integrations/chains/tron.ts`
- Create: `src/integrations/chains/simulator.ts`
- Test: `tests/unit/payment-settings/catalog.test.ts`
- Test: `tests/unit/payment-testing/environment-capabilities.test.ts`
- Test: `tests/integration/payment-testing/testnet-readiness.test.ts`

**Interfaces:**
- Add distinct rail codes `simulator`, `tron-nile`, `ethereum-sepolia`, `base-sepolia`, `bsc-testnet`, and `polygon-amoy`.
- Extend chain network identities without weakening existing mainnet discrimination.
- Export `assertPaymentModeAllowed(environmentCode, paymentMode, networkClass): void`.

- [ ] **Step 1: Write failing catalog and capability tests**

Cover every allowed/rejected environment/mode/class triple. Assert testnet rails are distinct from mainnet rails, simulator has no external connection requirement, and exchange/wallet rails without an explicit test environment do not appear in sandbox real-testnet options.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
bunx vitest run tests/unit/payment-settings/catalog.test.ts tests/unit/payment-testing/environment-capabilities.test.ts tests/integration/payment-testing/testnet-readiness.test.ts
```

Expected: FAIL because rails have no `networkClass` and runtime adapters do not recognize the new network identities.

- [ ] **Step 3: Implement the shared environment invariant**

Use one exhaustive mapping:

```ts
export function assertPaymentModeAllowed(
  environment: "sandbox" | "production",
  mode: "simulator" | "testnet" | "live",
  networkClass: "simulated" | "testnet" | "mainnet",
): void;
```

Return structured `DomainError` codes `payment_mode_environment_mismatch` and `payment_rail_class_mismatch`. Call it from readiness, run start, scenario execution, real-payment refresh, and confirmation consumption.

- [ ] **Step 4: Add verified native-asset testnet catalog entries**

Use only native assets in this release: TRX on Nile, ETH on Ethereum Sepolia and Base Sepolia, BNB on BSC Testnet, and POL on Polygon Amoy. Seed these official defaults:

| Rail | Chain ID | Default public endpoint |
| --- | ---: | --- |
| `tron-nile` | Nile | `https://nile.trongrid.io` |
| `ethereum-sepolia` | `11155111` | none; operator configures a provider or own node |
| `base-sepolia` | `84532` | `https://sepolia.base.org` |
| `bsc-testnet` | `97` | `https://bsc-testnet-dataseed.bnbchain.org` |
| `polygon-amoy` | `80002` | `https://rpc-amoy.polygon.technology` |

Do not add token contract addresses until separately verified. Keep Ethereum Sepolia supported but not ready until an operator configures a healthy endpoint. Sources: [TRON networks](https://developers.tron.network/docs/networks), [Ethereum networks](https://geth.ethereum.org/docs/fundamentals/private-network), [Base network information](https://docs.base.org/base-chain/quickstart/connecting-to-base), [BNB Smart Chain RPC endpoints](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/), and [Polygon Amoy tools](https://docs.polygon.technology/tools/dApp-development/common-tools/remix/).

- [ ] **Step 5: Implement adapter discrimination and readiness**

Parameterize EVM and TRON adapters with the catalog network identity and expected chain ID. Fail health/readiness when the RPC returns another chain. Add a simulator adapter that satisfies `PaymentAdapter` but never performs network I/O; only Task 5 may supply its observations. Readiness returns structured missing-connection, unhealthy-connection, missing-address, and environment-mismatch reasons.

- [ ] **Step 6: Verify and commit**

```bash
bunx vitest run tests/unit/payment-settings/catalog.test.ts tests/unit/payment-testing/environment-capabilities.test.ts tests/integration/payment-testing/testnet-readiness.test.ts
bunx biome check src/features/payment-settings/catalog.ts src/features/payment-settings/readiness.ts src/features/payment-settings/server/check-method-readiness.ts src/features/payment-settings/server/method-adapter.ts src/integrations/chains/types.ts src/integrations/chains/evm.ts src/integrations/chains/tron.ts src/integrations/chains/simulator.ts tests/unit/payment-settings/catalog.test.ts tests/unit/payment-testing/environment-capabilities.test.ts tests/integration/payment-testing/testnet-readiness.test.ts
git add src/features/payment-settings src/integrations/chains tests/unit/payment-settings/catalog.test.ts tests/unit/payment-testing/environment-capabilities.test.ts tests/integration/payment-testing/testnet-readiness.test.ts
git commit -m "feat: classify rails and add sandbox testnets"
```

### Task 3: Provision a Ready Sandbox for Every Merchant

**Files:**
- Create: `src/features/payment-testing/server/bootstrap.ts`
- Modify: `src/features/auth/server/registration.ts`
- Modify: `src/features/merchants/server/platform.ts`
- Modify: `src/features/merchants/server/payment-ingresses.ts`
- Modify: `src/features/installation/server/reconcile-payment-infrastructure.ts`
- Test: `tests/integration/tenant/registration.test.ts`
- Test: `tests/integration/tenant/platform-merchant.test.ts`
- Modify: `tests/integration/tenant/merchant-bootstrap.test.ts`

**Interfaces:**
- Export `buildSandboxTestBootstrap(input): SandboxTestBootstrapStatements` for both Drizzle batch and raw D1 batch callers, plus `ensureSandboxTestBootstrap(db, context)` for existing merchants.
- Create one enabled sandbox key with scopes `orders:create`, `orders:read`, `orders:update`, and `assets:read`.
- Create one simulator receiving method and derive one ready example preset from the scoped bootstrap resources, without creating an order or a preset table.

- [ ] **Step 1: Extend merchant bootstrap tests and verify failure**

Assert both self-registration and platform merchant creation atomically create exactly one sandbox test key, simulator ingress/method/asset binding, built-in callback capability, and a derivable example preset. Assert production gets none of these simulator resources and repeated runtime reconciliation creates no duplicates. A migrated existing merchant must receive the same resources on the first authorized reconciliation after migration.

```bash
bunx vitest run tests/integration/tenant/registration.test.ts tests/integration/tenant/platform-merchant.test.ts tests/integration/tenant/merchant-bootstrap.test.ts
```

Expected: FAIL because current bootstrap creates general ingress rows but no environment-aware test resources.

- [ ] **Step 2: Implement one shared bootstrap builder**

Generate the API secret with the existing key generator, encrypt with the existing runtime pepper, and return the plaintext only from the onboarding result that already owns one-time secret display. Use stable scoped resource names and unique constraints as the reconciliation marker so a retry inserts missing resources without rotating an existing key. For migrated merchants, reconcile before loading the default preset and retain the secret only server-side. Pass `{ id, code }` environments to ingress provisioning and filter mainnet defaults out of sandbox.

- [ ] **Step 3: Integrate both merchant creation paths and reconciliation**

Keep each merchant creation in its current single D1/Drizzle batch. Reconciliation fills only absent simulator/bootstrap rows and preserves all merchant edits. The default preset is computed from the bootstrapped key and receiving method, contains no raw secret, and creates no database row or order. Call reconciliation from the authenticated test-center loader and from installation infrastructure reconciliation so both Workers/D1 and Bun/SQLite converge.

- [ ] **Step 4: Verify and commit**

```bash
bunx vitest run tests/integration/tenant/registration.test.ts tests/integration/tenant/platform-merchant.test.ts tests/integration/tenant/merchant-bootstrap.test.ts
bunx biome check src/features/payment-testing/server/bootstrap.ts src/features/auth/server/registration.ts src/features/merchants/server/platform.ts src/features/merchants/server/payment-ingresses.ts src/features/installation/server/reconcile-payment-infrastructure.ts tests/integration/tenant/registration.test.ts tests/integration/tenant/platform-merchant.test.ts tests/integration/tenant/merchant-bootstrap.test.ts
git add src/features/payment-testing/server/bootstrap.ts src/features/auth/server/registration.ts src/features/merchants/server/platform.ts src/features/merchants/server/payment-ingresses.ts src/features/installation/server/reconcile-payment-infrastructure.ts tests/integration/tenant
git commit -m "feat: bootstrap merchant payment sandbox"
```

### Task 4: Build Preflight, Protocol Requests, and Production Confirmation

**Files:**
- Create: `src/features/payment-testing/schema.ts`
- Create: `src/features/payment-testing/types.ts`
- Create: `src/features/payment-testing/server/preflight.ts`
- Create: `src/features/payment-testing/server/protocol-request.ts`
- Create: `src/features/payment-testing/server/runs.ts`
- Create: `src/features/payment-testing/server/confirmation.ts`
- Test: `tests/integration/payment-testing/protocol-run.test.ts`
- Test: `tests/security/payment-testing/production-confirmation.test.ts`
- Test: `tests/security/payment-testing/scope-isolation.test.ts`

**Interfaces:**

```ts
export async function preflightPaymentTest(
  db: D1Database,
  context: MerchantAccessContext,
  input: PaymentTestStartInput,
): Promise<PaymentTestPreflight>;

export async function startPaymentTestRun(
  env: Pick<Env, "DB" | "PAYMENTS" | "WEBHOOKS">,
  context: MerchantAccessContext,
  input: PaymentTestStartInput,
): Promise<PaymentTestStartResult>;

export async function confirmProductionPaymentTestRun(
  env: Pick<Env, "DB" | "PAYMENTS" | "WEBHOOKS">,
  context: MerchantAccessContext,
  input: { runId: string; confirmationToken: string },
): Promise<PaymentTestStartResult>;
```

- [ ] **Step 1: Write failing signed-protocol tests**

For GMPay and EPay, create scoped keys and assert the test center constructs a real `Request`, invokes `handleGmpayCreateRequest` or `handleEpayCreateRequest`, exercises authentication/rate limiting/idempotency, stores only a redacted snapshot, and associates the resulting order with the run. Assert raw console input is parsed by the existing protocol schemas before signing.

- [ ] **Step 2: Write failing production token and isolation tests**

Cover token tampering, expiry, reuse, another user, another merchant/environment, changed amount/network/callback, production simulator request, sandbox mainnet request, and foreign run/key/method IDs. All failures must occur before order creation and return structured generic errors.

- [ ] **Step 3: Run tests and verify failure**

```bash
bunx vitest run tests/integration/payment-testing/protocol-run.test.ts tests/security/payment-testing/production-confirmation.test.ts tests/security/payment-testing/scope-isolation.test.ts
```

Expected: FAIL because the payment-testing feature and confirmation contract do not exist.

- [ ] **Step 4: Implement boundary schemas and preflight**

Validate protocol, mode, key, method, amount minor string, currency, asset, return URL, callback selection, and client idempotency once with Zod. Preflight loads all selected rows in current scope, calls the shared readiness/environment invariant, validates custom callbacks through the existing HTTPS/DNS/SSRF policy, verifies required Queue bindings, and returns stable reason codes with localized UI mapping.

- [ ] **Step 5: Invoke the real protocol handlers**

Decrypt the selected secret inside the request lifetime, build canonical GMPay JSON or EPay form/query parameters, sign with `signGmpayParameters` or `signEpayParameters`, construct a local `Request`, and call the existing handler function with the existing `createOrder` dependency. Parse only the public handler response. Persist redacted signing input, request/response, status, duration, and request ID; always replace `signature`, `sign`, cookie, authorization, and token-like values with `[REDACTED]`.

- [ ] **Step 6: Implement one-time production confirmation**

Bind token HMAC input to run/user/merchant/environment/protocol/key/amount/currency/asset/network/callback digest/expiry/nonce. Persist only nonce hash and expiry. Consume with one conditional `UPDATE ... WHERE confirmation_consumed_at IS NULL AND confirmation_expires_at >= ?`; only the winning request invokes the protocol handler. Re-run the environment invariant after consumption and immediately before order creation.

- [ ] **Step 7: Verify and commit**

```bash
bunx vitest run tests/integration/payment-testing/protocol-run.test.ts tests/security/payment-testing/production-confirmation.test.ts tests/security/payment-testing/scope-isolation.test.ts tests/integration/gmpay-authentication.test.ts tests/integration/epay-create-handler.test.ts
bunx biome check src/features/payment-testing tests/integration/payment-testing/protocol-run.test.ts tests/security/payment-testing
git add src/features/payment-testing/schema.ts src/features/payment-testing/types.ts src/features/payment-testing/server/preflight.ts src/features/payment-testing/server/protocol-request.ts src/features/payment-testing/server/runs.ts src/features/payment-testing/server/confirmation.ts tests/integration/payment-testing/protocol-run.test.ts tests/security/payment-testing
git commit -m "feat: create signed payment test runs"
```

### Task 5: Drive Simulator Scenarios Through Payment Ingestion

**Files:**
- Create: `src/features/payment-testing/server/simulator.ts`
- Modify: `src/integrations/chains/simulator.ts`
- Modify: `src/features/orders/server/admin.ts`
- Test: `tests/integration/payment-testing/simulator-scenarios.test.ts`
- Modify: `tests/integration/payment-flow.test.ts`
- Test: `tests/security/payment-testing/simulator-access.test.ts`

**Interfaces:**

```ts
export const simulatorScenarios = [
  "exact_success",
  "partial_then_complete",
  "overpayment",
  "confirmation_progression",
  "failed_transaction",
  "duplicate_delivery",
  "late_payment",
  "reorg_then_recover",
  "callback_failure_then_retry",
] as const;

export async function advanceSimulatorScenario(
  env: PaymentRuntime,
  context: MerchantAccessContext,
  input: { runId: string; scenario: SimulatorScenario; step: number },
): Promise<{ runId: string; orderStatus: OrderStatus; duplicate: boolean }>;
```

- [ ] **Step 1: Write failing scenario and access tests**

Assert deterministic `(runId, scenario, step)` transaction identity, partial/completion accumulation, overpayment, confirmation changes, failed provider transaction, duplicate idempotency, expiry/late policy, canonical rollback and recovery, and callback failure setup. Assert production, non-mock snapshots, invalid step order, foreign scope, or missing `merchant:update` fails before payment mutation.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
bunx vitest run tests/integration/payment-testing/simulator-scenarios.test.ts tests/security/payment-testing/simulator-access.test.ts
```

Expected: FAIL because no persisted scenario engine exists.

- [ ] **Step 3: Implement deterministic observations**

Load the scoped run/order/payment snapshot, verify sandbox + simulator + simulated rail + mock adapter, then derive typed `NormalizedTransaction` values from the scenario table. Use integer `amountUnits`, explicit confirmations, canonical/block identity, success state, and deterministic hashes. Call `recordPaymentTransaction` for every observation and let existing payment/audit/Webhook code decide the order state.

- [ ] **Step 4: Remove arbitrary production-facing status mutation**

Keep `createDevelopmentOrderFn` and `simulateDevelopmentOrderStatusFn` behind `import.meta.env.DEV` only if remaining local tests need them. Route all test-center actions through `advanceSimulatorScenario`; do not broaden the existing platform-admin mock action. Remove dead exports/tests only when `rg` and focused coverage prove no consumer.

- [ ] **Step 5: Verify and commit**

```bash
bunx vitest run tests/integration/payment-testing/simulator-scenarios.test.ts tests/security/payment-testing/simulator-access.test.ts tests/integration/payment-flow.test.ts
bunx biome check src/features/payment-testing/server/simulator.ts src/integrations/chains/simulator.ts src/features/orders/server/admin.ts tests/integration/payment-testing/simulator-scenarios.test.ts tests/security/payment-testing/simulator-access.test.ts tests/integration/payment-flow.test.ts
git add src/features/payment-testing/server/simulator.ts src/integrations/chains/simulator.ts src/features/orders/server/admin.ts tests/integration/payment-testing/simulator-scenarios.test.ts tests/security/payment-testing/simulator-access.test.ts tests/integration/payment-flow.test.ts
git commit -m "feat: add payment simulator scenarios"
```

### Task 6: Add the Built-In Callback Receiver and Evidence Timeline

**Files:**
- Create: `src/features/payment-testing/server/callback.ts`
- Create: `src/features/payment-testing/server/timeline.ts`
- Create: `src/routes/api/test-callbacks/$token.ts`
- Modify: `src/features/webhooks/types.ts`
- Modify: `src/features/webhooks/server/delivery.ts`
- Modify: `src/features/webhooks/server/consumer.ts`
- Test: `tests/integration/payment-testing/builtin-callback.test.ts`
- Test: `tests/integration/payment-testing/timeline.test.ts`
- Modify: `tests/integration/webhook-consumer.test.ts`
- Test: `tests/security/payment-testing/callback-security.test.ts`

**Interfaces:**
- Built-in callback path: `/api/test-callbacks/:token` with a 256-bit opaque token shown only inside the notify URL.
- Export `handlePaymentTestCallback(request, env): Promise<Response>`.
- Export `loadPaymentTestTimeline(db, context, runId): Promise<PaymentTestTimeline>`.

- [ ] **Step 1: Write failing receiver, retry, and timeline tests**

Cover valid GMPay `ok` and EPay `success`, invalid/expired token, invalid signature, oversized body, duplicate delivery attempt, callback retry, custom callback evidence, and another merchant's run. Assert invalid tokens use one generic response and do not reveal run existence. Assert timeline order is deterministic by timestamp and stable event priority.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
bunx vitest run tests/integration/payment-testing/builtin-callback.test.ts tests/integration/payment-testing/timeline.test.ts tests/integration/webhook-consumer.test.ts tests/security/payment-testing/callback-security.test.ts
```

Expected: FAIL because the callback route, receipt table integration, and aggregate timeline do not exist.

- [ ] **Step 3: Implement bounded signed callback handling**

Hash the path token, load an unexpired running run, parse at most the existing Webhook body limit, authenticate the GMPay or EPay signature with the scoped run key, and compare in constant time. Store redacted headers/body, event ID, delivery ID, attempt number, signature status, acknowledgement, and receive time. Return only protocol-required plain text. Add `x-gmpay-attempt` to delivery requests so retries correlate without moving existing attempt persistence ahead of network I/O.

- [ ] **Step 4: Permit only the instance-owned callback target**

Keep the existing public HTTPS/DNS/SSRF validation for all merchant custom URLs. Add a narrow delivery policy branch that recognizes a callback URL created from the authoritative instance origin plus a valid unexpired run token; do not allow arbitrary loopback/private URLs and do not relax `isSafeWebhookUrl` globally. Verify the branch in Workers and Bun tests.

- [ ] **Step 5: Compose evidence and reconcile pass/fail**

Join the scoped run to order snapshot, payments, blockchain rows, audit log, Webhook event/delivery/attempts, and callback receipts. Do not duplicate those records into the run. A run passes only when its explicit expected order state and required callback success are both observed; terminal provider/callback errors set a structured failure code. A retryable callback keeps the run `running`.

- [ ] **Step 6: Verify and commit**

```bash
bunx vitest run tests/integration/payment-testing/builtin-callback.test.ts tests/integration/payment-testing/timeline.test.ts tests/integration/webhook-consumer.test.ts tests/security/payment-testing/callback-security.test.ts
bunx biome check src/features/payment-testing/server/callback.ts src/features/payment-testing/server/timeline.ts 'src/routes/api/test-callbacks/$token.ts' src/features/webhooks/types.ts src/features/webhooks/server/delivery.ts src/features/webhooks/server/consumer.ts tests/integration/payment-testing tests/integration/webhook-consumer.test.ts tests/security/payment-testing/callback-security.test.ts
git add src/features/payment-testing/server/callback.ts src/features/payment-testing/server/timeline.ts 'src/routes/api/test-callbacks/$token.ts' src/features/webhooks tests/integration/payment-testing tests/integration/webhook-consumer.test.ts tests/security/payment-testing/callback-security.test.ts
git commit -m "feat: close payment test callback loop"
```

### Task 7: Expose Authorized Server Functions and Semantic Routes

**Files:**
- Create: `src/features/payment-testing/server/functions.ts`
- Create: `src/routes/admin/test-center/route.tsx`
- Create: `src/routes/admin/test-center/index.tsx`
- Create: `src/routes/admin/test-center/console.tsx`
- Create: `src/routes/admin/test-center/runs.tsx`
- Create: `src/routes/admin/test-center/runs/$runId.tsx`
- Modify: `src/layouts/components/data/sidebar-data.ts`
- Modify: `src/routes/admin/route.tsx`
- Test: `tests/security/server-entry-authorization.test.ts`
- Modify: `tests/unit/admin-route-navigation.test.ts`
- Modify: `tests/unit/layouts/merchant-sidebar.test.ts`

**Interfaces:**
- `merchant:read`: `listPaymentTestRunsFn`, `getPaymentTestRunFn`.
- `merchant:create`: `preflightPaymentTestFn`, `startPaymentTestRunFn`, `confirmProductionPaymentTestRunFn`.
- `merchant:update`: `advanceSimulatorScenarioFn`, `refreshRealPaymentTestRunFn`, `retryPaymentTestWebhookFn`, `cancelPaymentTestRunFn`.

- [ ] **Step 1: Write failing server-entry and navigation tests**

Assert each exported server function has the exact permission above, validates the selected context, and fails closed for foreign IDs. Assert `/admin/test-center`, `/console`, `/runs`, and `/runs/:runId` are allowed and selected for merchant users with read permission and platform root only after selecting merchant/environment context.

- [ ] **Step 2: Run tests and verify failure**

```bash
bunx vitest run tests/security/server-entry-authorization.test.ts tests/unit/admin-route-navigation.test.ts tests/unit/layouts/merchant-sidebar.test.ts
```

Expected: FAIL because server entries and navigation routes do not exist.

- [ ] **Step 3: Implement server function boundaries**

Use `createServerFn`, Zod validators from `payment-testing/schema.ts`, `getRequest`, `getDb`, and `requireMerchantAccess`. Keep loaders/routes limited to search/params, access, and mounting. Paginate history by bounded cursor using `(created_at, id)`; never expose raw tokens, secret material, unredacted snapshots, internal stack traces, or another scope's existence.

- [ ] **Step 4: Add semantic routes and shared navigation authority**

Mount the test center under the existing integrations group. Use route files, not a query parameter, for guided, console, history, and detail views. Ensure sidebar, command menu, default child, active selection, and access checks derive from the same navigation entry.

- [ ] **Step 5: Generate routes, verify, and commit**

```bash
bun run generate-routes
bunx vitest run tests/security/server-entry-authorization.test.ts tests/unit/admin-route-navigation.test.ts tests/unit/layouts/merchant-sidebar.test.ts
bunx biome check src/features/payment-testing/server/functions.ts src/routes/admin/test-center src/layouts/components/data/sidebar-data.ts src/routes/admin/route.tsx tests/security/server-entry-authorization.test.ts tests/unit/admin-route-navigation.test.ts tests/unit/layouts/merchant-sidebar.test.ts
git add src/features/payment-testing/server/functions.ts src/routes/admin/test-center src/layouts/components/data/sidebar-data.ts src/routes/admin/route.tsx src/routeTree.gen.ts tests/security/server-entry-authorization.test.ts tests/unit/admin-route-navigation.test.ts tests/unit/layouts/merchant-sidebar.test.ts
git commit -m "feat: expose payment test center routes"
```

### Task 8: Build the Guided Test, API Console, History, and Timeline UI

**Files:**
- Create: `src/features/payment-testing/pages/guided-test.tsx`
- Create: `src/features/payment-testing/pages/api-console.tsx`
- Create: `src/features/payment-testing/pages/history.tsx`
- Create: `src/features/payment-testing/pages/run-detail.tsx`
- Create: `src/features/payment-testing/components/environment-boundary.tsx`
- Create: `src/features/payment-testing/components/run-timeline.tsx`
- Modify: `messages/en-US.json`
- Modify: `messages/ja-JP.json`
- Modify: `messages/ko-KR.json`
- Modify: `messages/ru-RU.json`
- Modify: `messages/zh-TW.json`
- Modify: `messages/zh-CN.json`
- Test: `tests/unit/payment-testing/pages.test.tsx`
- Test: `tests/e2e/payment-test-center.spec.ts`

**Interfaces:**
- Guided test is the `/admin/test-center` index route.
- API console has structured/raw views of one typed request and GMPay/EPay segmented protocol control.
- History uses ProTable pagination; detail renders one chronological evidence timeline.

- [ ] **Step 1: Write failing component and browser tests**

Cover sandbox simulator default, protocol switching, production second confirmation contents, keyboard traversal, associated error messages, focus restoration, context switch invalidation, pagination, timeline states, secret redaction, responsive mobile layout, reduced motion, and light/dark semantic contrast. Assert no simulator control renders in production and server rejection remains covered separately.

- [ ] **Step 2: Run component tests and verify failure**

```bash
bunx vitest run tests/unit/payment-testing/pages.test.tsx
```

Expected: FAIL because payment test center pages do not exist.

- [ ] **Step 3: Implement the guided workflow**

Use ProForm fields for protocol, mode, key, amount, currency, asset, rail, return URL, and callback. Show preflight results inline. The production confirmation lists merchant, amount, currency, asset, network, callback destination, and localized `real funds` wording, then consumes the short-lived token. After creation, show checkout, query, next scenario/check action, and live status without adding explanatory marketing copy.

- [ ] **Step 4: Implement console, history, and detail**

Use a segmented protocol control and structured/raw tabs. Display endpoint, method, PID, normalized signing input, redacted signature/request, status, response, request ID, and duration. Use ProTable's built-in refresh for history. Timeline events use icons plus labels and independent light/dark semantic tokens; do not put cards inside cards.

- [ ] **Step 5: Add all six locales and regenerate Paraglide**

Keep identifiers identical across locale JSON files; use native locale formatting for amounts, times, statuses, rails, and scenarios.

```bash
bun run generate-paraglide
bun run generate-routes
```

- [ ] **Step 6: Verify unit UI behavior and commit**

```bash
bunx vitest run tests/unit/payment-testing/pages.test.tsx tests/unit/admin-route-navigation.test.ts tests/unit/layouts/merchant-sidebar.test.ts
bunx biome check src/features/payment-testing/pages src/features/payment-testing/components src/routes/admin/test-center messages tests/unit/payment-testing/pages.test.tsx tests/e2e/payment-test-center.spec.ts
git add src/features/payment-testing/pages src/features/payment-testing/components src/routes/admin/test-center messages src/paraglide src/routeTree.gen.ts tests/unit/payment-testing/pages.test.tsx tests/e2e/payment-test-center.spec.ts
git commit -m "feat: add payment test center interface"
```

### Task 9: Add Retention, Observability, Runtime Parity, and Security Coverage

**Files:**
- Modify: `src/server/operational-settings.ts`
- Modify: `src/features/operations/server/operational-retention.ts`
- Modify: `src/server/scheduled/maintenance.ts`
- Create: `src/features/payment-testing/server/observability.ts`
- Test: `tests/integration/payment-testing/retention.test.ts`
- Test: `tests/integration/payment-testing/runtime-parity.test.ts`
- Test: `tests/security/payment-testing/snapshot-redaction.test.ts`
- Test: `tests/security/payment-testing/custom-callback-ssrf.test.ts`
- Modify: `tests/unit/server/node-runtime-adapters.test.ts`

**Interfaces:**
- Retention deletes expired run/receipt evidence only; it never deletes referenced orders, payments, Webhook events/attempts, or audit records.
- Timing dimensions are `preflight`, `protocol_request`, `order_create`, `payment_detect`, `confirmation`, and `callback_delivery` with privacy-safe labels.

- [ ] **Step 1: Write failing retention, redaction, SSRF, and parity tests**

Assert minimum/maximum test evidence retention, preserved production/order records, bounded snapshot bytes, recursive secret/token redaction, DNS rebinding/private host rejection, callback-only internal-origin exception, Queue recovery, and identical D1/SQLite behavior.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
bunx vitest run tests/integration/payment-testing/retention.test.ts tests/integration/payment-testing/runtime-parity.test.ts tests/security/payment-testing/snapshot-redaction.test.ts tests/security/payment-testing/custom-callback-ssrf.test.ts
bun test tests/unit/server/node-runtime-adapters.test.ts
```

Expected: FAIL on missing test evidence retention/metrics/runtime hooks.

- [ ] **Step 3: Implement bounded retention and metrics**

Extend the existing operational settings parser with bounded test evidence days. Delete receipts before runs in bounded batches and leave domain records intact. Emit timing and result counters through existing metrics plumbing using only protocol, environment, mode, scenario, result, and error code labels; do not label with merchant, URL, PID, address, order ID, or token.

- [ ] **Step 4: Verify Workers/Bun behavior and simplify the touched diff**

Run focused parity/security tests. Then use `rg` to find duplicate mode checks, redaction branches, dead development actions, and unused exports. Keep the one shared invariant/redactor where it reduces callers; preserve feature boundaries and avoid unrelated formatting.

- [ ] **Step 5: Commit**

```bash
bunx vitest run tests/integration/payment-testing/retention.test.ts tests/integration/payment-testing/runtime-parity.test.ts tests/security/payment-testing/snapshot-redaction.test.ts tests/security/payment-testing/custom-callback-ssrf.test.ts
bun test tests/unit/server/node-runtime-adapters.test.ts
bunx biome check src/server/operational-settings.ts src/features/operations/server/operational-retention.ts src/server/scheduled/maintenance.ts src/features/payment-testing/server/observability.ts tests/integration/payment-testing tests/security/payment-testing tests/unit/server/node-runtime-adapters.test.ts
git add src/server/operational-settings.ts src/features/operations/server/operational-retention.ts src/server/scheduled/maintenance.ts src/features/payment-testing/server/observability.ts tests/integration/payment-testing tests/security/payment-testing tests/unit/server/node-runtime-adapters.test.ts
git commit -m "feat: harden payment test operations"
```

### Task 10: Document, Verify, Push, Migrate, and Deploy

**Files:**
- Create: `docs/PAYMENT_TESTING.md`
- Create: `docs/PAYMENT_TESTING.zh-CN.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `tests/e2e/payment-test-center.spec.ts`

- [ ] **Step 1: Write paired operator and merchant documentation**

Document sandbox simulator setup, first-release testnet configuration, faucet/address prerequisites, API console behavior, built-in/custom callback evidence, production real-funds confirmation, permissions, retention, and troubleshooting. State that Ethereum Sepolia requires an operator-configured endpoint and that TON/Aptos/Solana are simulator-only in this release. Include no real credentials or private key instructions.

- [ ] **Step 2: Run the final quality gate once on the final tree**

```bash
bun run typecheck
bun run test
bun run check
bun run build
bun run build:bun
```

Expected: all five commands exit `0`. Record any unconditionally skipped manual provider suites as retained manual evidence, not automated success.

- [ ] **Step 3: Rehearse the migration on disposable local D1 and SQLite data**

Apply the complete migration chain to a fresh database and a representative pre-`0011` copy. Verify row counts, zero orphans/duplicates, rail classes, sandbox bootstrap, query plans, and `PRAGMA optimize`. Start both Workers local runtime and Bun output, create GMPay/EPay simulator runs, and prove callback receipt/pass state in each runtime.

- [ ] **Step 4: Run browser acceptance in both themes and responsive sizes**

Start the local server, then use the in-app browser to exercise guided test, API console, history, detail, environment switch, production confirmation cancellation, keyboard navigation, reduced motion, and built-in callback. Capture desktop and mobile screenshots in light and dark themes and verify text/controls do not overlap.

- [ ] **Step 5: Commit delivery documentation and final generated files**

```bash
git add docs/PAYMENT_TESTING.md docs/PAYMENT_TESTING.zh-CN.md README.md README.zh-CN.md tests/e2e/payment-test-center.spec.ts
git commit -m "docs: document payment test workflows"
git status --short --branch
git log --oneline --decorate -12
```

Expected: clean worktree and local commits ahead of `origin/main` only by the planned change set.

- [ ] **Step 6: Push and deploy after all evidence is green**

```bash
bun run predeploy
git push origin main
bun run db:migrate:remote
bun run deploy
```

Do not run the remote migration or deploy if push, quality gate, local migration rehearsal, or `predeploy` fails. Record the Git commit, Cloudflare deployment/version ID, migration result, and served asset hash.

- [ ] **Step 7: Verify production behavior**

Verify `https://pay.gelooss.com/admin/test-center` loads the deployed bundle after authenticated merchant/environment selection. Run a sandbox GMPay simulator exact-success flow and an EPay callback-retry flow, then confirm history/timeline evidence and light/dark behavior. For each configured real testnet, perform a bounded manual transfer and retain transaction evidence. Production verification stops after confirmation preview unless a separately authorized real-funds amount and destination are supplied.

## Spec Coverage Matrix

| Approved design requirement | Implementation tasks |
| --- | --- |
| Unified guided/API/history test center | 4, 7, 8 |
| GMPay + EPay real handler invocation | 4 |
| Sandbox simulator through real payment state | 2, 5 |
| Production one-time confirmation and no simulation | 2, 4, 7 |
| Built-in and custom callbacks with retries | 4, 6 |
| Automatic merchant sandbox bootstrap | 1, 3 |
| First-release testnets and merchant addresses | 2, 3, 10 |
| Persisted timeline and pass/fail evidence | 1, 6, 8 |
| Merchant/environment/RBAC isolation | 4, 5, 6, 7, 9 |
| Six locales, light/dark, responsive accessibility | 8, 10 |
| Workers/Bun parity, retention, observability | 9, 10 |
| GitHub push and Cloudflare deployment | 10 |
