# GMPay Edge Payment Test Center Design

**Status:** Approved for implementation planning

**Date:** 2026-09-01

**Companion:** `2026-09-01-payment-test-center-design.zh-CN.md`

## Goal

Add an environment-aware payment test center where a merchant can initiate,
complete, and diagnose GMPay or EPay payment flows without leaving the
authenticated application. A test run must cover request signing, merchant API
authentication, order creation, checkout, payment ingestion, order state,
Webhook delivery, callback acknowledgement, and final pass/fail evidence.

The test center is part of the existing multi-merchant product. It does not add
a second order service, payment state machine, Webhook implementation, router,
authentication system, or persistence layer.

## Current State and Gap

The application already has merchant-scoped sandbox and production
environments, environment-scoped API keys and receiving methods, shared
GMPay/EPay order creation, checkout, payment ingestion, Webhook outbox delivery,
retry records, and merchant order lists.

Existing development tools are not a product test loop:

- development order creation and arbitrary status changes are restricted to
  local `import.meta.env.DEV` builds;
- the mock payment action is platform-admin oriented and checks only the mock
  adapter, not the complete merchant/environment boundary;
- request, order, payment, and callback evidence is spread across unrelated
  pages;
- the built-in payment catalog is mainnet-oriented and does not represent
  testnets as distinct network identities.

## Confirmed Decisions

- Add one unified payment test center rather than a separate sandbox subsystem.
- Support both a guided flow and an API console.
- Support GMPay and EPay, with GMPay selected by default.
- Sandbox supports a built-in simulator and explicitly configured real
  testnets.
- Production can initiate a real order after a second confirmation and never
  exposes or accepts simulation operations.
- Support both an instance-owned callback receiver and a merchant-provided
  callback URL.
- Automatically provision a ready-to-run sandbox credential, simulated
  receiving method, built-in callback capability, and example preset for each
  new merchant.
- Introduce testnets progressively. The first real-testnet release covers TRON
  Nile, Ethereum Sepolia, Base Sepolia, BSC Testnet, and Polygon Amoy. TON,
  Aptos, and Solana remain simulator-only until their real-testnet adapters and
  catalogs are implemented and verified.
- A merchant supplies its own receiving address for real testnets and live
  mainnets. GMPay Edge never creates or stores a private key or seed phrase.

## Product Structure

Add `/admin/test-center` under the existing integrations navigation group. The
route remains thin and mounts a feature-owned page under
`src/features/payment-testing`.

The page follows the selected merchant/environment context and exposes three
semantic views:

1. **Guided test** collects protocol, mode, API key, amount, currency, asset,
   network, return URL, and callback choice, then drives one complete run.
2. **API console** exposes structured parameters and a raw request view, signs
   server-side, sends through the real protocol handler, and shows a redacted
   request and response.
3. **Test history** lists persisted runs and opens a run detail view with one
   chronological timeline.

The existing merchant/environment switcher remains the authority. Every query
key, loader, mutation, URL, and server function resolves the current context;
changing context invalidates test-center data.

## Environment Capability Matrix

| Capability | Sandbox | Production |
| --- | --- | --- |
| Built-in payment simulation | Allowed | Rejected server-side |
| Real testnet payment | Allowed | Rejected server-side |
| Real mainnet payment | Rejected server-side | Allowed |
| Admin-initiated order | Allowed | Allowed after confirmation |
| Built-in callback receiver | Allowed | Allowed |
| Custom merchant callback | Allowed | Allowed |
| API keys, addresses, runs, and orders | Sandbox scope only | Production scope only |

The UI uses text, an icon, and semantic color for environment identity. Color
alone never communicates the boundary. A production action displays merchant,
amount, currency, asset, network, callback destination, and the phrase "real
funds" before confirmation.

## End-to-End Run

One `payment_test_run` is the aggregation root for exactly one order attempt:

```text
select merchant/environment
  -> select GMPay or EPay and payment mode
  -> run readiness checks
  -> build and sign a server-side protocol request
  -> invoke the existing merchant API Request/Response handler
  -> create the scoped order and checkout URL
  -> simulate a provider event or wait for a real network payment
  -> process the existing payment state machine
  -> commit the existing Webhook outbox event
  -> deliver to the built-in or custom callback endpoint
  -> aggregate evidence and mark the run passed or failed
```

The test-center server constructs a real `Request` and invokes the same GMPay or
EPay handler used by the public route. It must not call `createOrder` directly.
This exercises parsing, signature verification, API-key scope, rate limiting,
idempotency, receiving-method allocation, and protocol response formatting
without an unreliable Worker self-fetch.

## Guided Test

The guided flow performs a preflight before order creation:

- selected API key is active, unexpired, in the current environment, and has
  the required order scopes;
- selected receiving method belongs to the current merchant/environment and is
  ready;
- asset, network, amount limits, exchange rate, connection health, and queue
  bindings are available;
- the custom callback URL passes the existing HTTPS, DNS, SSRF, and retry-policy
  checks;
- simulator, testnet, and mainnet modes agree with the selected environment and
  payment rail network class.

A successful create shows the protocol response and exposes the checkout action.
The run then stays live through visible/online polling and Queue-driven status
updates. Refreshing or signing in again resumes the same persisted run.

## API Console

The API console uses a segmented GMPay/EPay control and offers structured form
and raw views of the same typed payload. It displays:

- environment-resolved endpoint and HTTP method;
- PID, included signing fields, normalized signing input, and resulting
  signature;
- redacted request headers/body;
- response status, headers, body, request ID, and duration;
- order query and checkout actions after successful creation.

The API secret is decrypted only inside the server request lifetime. It is
never returned to the client, persisted in a test-run snapshot, placed in KV,
or logged. Raw mode is parsed and validated with the existing protocol Zod
schemas before signing.

## Production Confirmation

Production preflight creates a `ready` test run and returns a short-lived signed
confirmation token bound to:

- run, user, merchant, and production environment IDs;
- protocol and API key ID;
- amount, currency, asset, network, and callback destination digest;
- expiry and random nonce.

The raw token is not persisted. Its nonce hash and expiry are stored on the run.
Confirmation atomically consumes the nonce before invoking the protocol handler.
Changing any bound field, reusing the token, using another account, or waiting
past expiry fails closed. This is independent of the normal order idempotency
key and does not weaken it.

## Sandbox Simulator

The simulator is a test-only provider-event source, not an order-status editor.
Each scenario creates typed provider-like payment events and sends them through
the normal attribution, payment ingestion, confirmation, state transition,
audit, and Webhook outbox path.

Initial scenarios are:

- exact successful payment;
- partial payment followed by completion;
- overpayment;
- confirmation progression;
- failed provider transaction;
- duplicate event delivery;
- late payment after expiry;
- confirmation rollback and recovery after a simulated reorganization;
- callback failure followed by the normal retry flow.

The existing development function that directly writes arbitrary order status
is not reused by the production test center. It remains local-only or is removed
after its tests have equivalents in the scenario engine.

A simulation entry point requires all of the following on every call:

```text
current environment is sandbox
run, order, API key, and receiving method share merchant/environment scope
run payment mode is simulator
receiving snapshot adapter is mock
operator has merchant update permission
scenario transition is valid for the stored run state
```

## Real Testnet Model

Testnets are first-class payment rails, not alternate URLs hidden behind a
mainnet rail. Extend the global rail catalog with an explicit network class:
`mainnet`, `testnet`, or `simulated`. Add separate rail codes and asset rows for:

- `tron-nile`;
- `ethereum-sepolia`;
- `base-sepolia`;
- `bsc-testnet`;
- `polygon-amoy`;
- one global simulator rail that only the sandbox bootstrap may use.

Each testnet has its own RPC/HTTP/WSS connection rows, chain identity,
contract-address catalog, decimals, confirmations, health, scan cursor, and
receiving methods. Contract addresses and public endpoints are added only from
verified official sources during implementation; the design does not invent
fallback values.

Readiness enforces this mapping:

- sandbox accepts only `testnet` or `simulated` rails;
- production accepts only `mainnet` rails;
- exchange or wallet adapters without an explicit test environment do not
  appear as real-testnet options.

Testnet receipts use the normal adapter and scanner behavior. Simulator support
does not count as live-provider readiness for a chain.

## Automatic Sandbox Bootstrap

Merchant creation extends the existing atomic bootstrap with:

- one enabled sandbox API key with GMPay/EPay order create/read/update and asset
  read scopes;
- one simulated sandbox rail/asset receiving method;
- built-in callback receiver capability;
- a ready-to-run example preset, without creating an order before the merchant
  explicitly starts it.

The generated API secret is encrypted with the existing secret contract and is
shown once during onboarding. The test center may later use it server-side for
signed requests, but never reveals it again. Real testnet receiving methods are
enabled only after the merchant supplies a valid public address.

## Persistence

Add the following Drizzle tables under the existing payments/Webhook ownership
boundaries.

### `payment_test_runs`

Required fields include:

- `id`, `merchant_id`, `environment_id`, and `created_by_user_id`;
- `protocol` (`gmpay` or `epay`);
- `payment_mode` (`simulator`, `testnet`, or `live`);
- `api_key_id`, `external_order_id`, and nullable `order_id`;
- `callback_mode` (`builtin` or `custom`) and a redacted destination snapshot;
- `status` (`ready`, `running`, `passed`, `failed`, `cancelled`, or `expired`);
- versioned, bounded, schema-validated redacted request/response snapshots;
- confirmation nonce hash/expiry/consumed time for production runs;
- structured failure code, start/completion time, and normal timestamps.

Use a scoped unique idempotency constraint for run creation and a unique
nullable order association. Scope-leading indexes support history and active
run queries.

### `payment_test_callback_receipts`

Required fields include run, Webhook event/delivery/attempt identity, signature
status, bounded redacted headers/body, response acknowledgement, received time,
and timestamps. A retry is visible as a separate attempt while duplicate
delivery identity is idempotent.

The built-in callback route uses an opaque high-entropy per-run token. Only its
hash and expiry are stored. The handler accepts a bounded body, validates the
token and Webhook signature, records the receipt, returns the protocol-required
plain-text acknowledgement, and reveals no run existence on invalid input.

## Timeline and Pass Criteria

The run detail query composes existing records rather than copying their state:

- test run and redacted protocol request/response;
- order and payment snapshot;
- payment transactions and confirmation changes;
- audit entries associated with the run/order;
- Webhook event, delivery, attempts, response status, and duration;
- built-in callback receipts when selected.

A normal run passes only when the order reaches the expected successful payment
state and its required callback delivery succeeds. Scenario-specific runs use
explicit expected states, such as partial or overpayment, and pass only after
the expected state and Webhook evidence are observed. A failed callback keeps
the run failed or running according to the existing retry policy; it cannot be
reported as passed merely because the order was paid.

## Authorization and Navigation

Reuse merchant permission masks:

- `merchant:read` lists runs and reads details;
- `merchant:create` performs preflight and initiates an order;
- `merchant:update` runs sandbox scenarios, cancels an active run, checks a
  real payment, and retries a Webhook;
- no test-center operation uses the delete bit.

Platform root access still requires selecting a concrete merchant/environment
context and never bypasses environment-mode checks. Navigation visibility comes
from the shared navigation authority and matches the server permission.

All identifiers are re-scoped server-side. A run or order ID from another
merchant/environment returns a generic not-found/access-denied domain error.

## Error Handling and Idempotency

- Every server entry validates input once with Zod and returns structured domain
  errors mapped at the server-function or HTTP boundary.
- Preflight failures identify the actionable category without exposing SQL,
  decrypted credentials, provider payloads, internal IDs, or stack traces.
- Starting a run uses a client-generated idempotency key scoped by merchant,
  environment, protocol, and API key.
- Protocol order creation keeps the existing merchant order idempotency model.
- Scenario events have deterministic run/scenario/step identity so a retry
  cannot create a duplicate payment.
- Page refresh, Queue redelivery, and callback retry resume persisted state.
- Cancellation never cancels, refunds, or mutates an already paid real order.

## UI, Theme, Accessibility, and Internationalization

Use existing `PageHeader`, ProForm, ProTable, Radix/shadcn controls, environment
badges, status badges, and design tokens. Do not nest cards or add a competing
wizard/form library. The workflow is compact and task-focused rather than a
marketing page.

Light and dark themes define independent semantic surfaces, borders, code
backgrounds, warning states, and timeline colors. Sandbox and production labels
remain legible in both themes. Fixed controls use stable dimensions and text
wraps without overlap on mobile.

All user-facing content is added to all six Paraglide locales. Keyboard access,
accessible names, focus restoration, reduced motion, visible error association,
and screen-reader environment announcements are required.

## Observability and Retention

Record privacy-safe timing for preflight, protocol request, order creation,
payment detection, confirmation, and callback delivery. Reuse existing request
IDs, D1 row metrics, Queue age/retry metrics, and audit logging. Never log
signing secrets or unredacted callback authorization values.

Test runs and callback receipts follow the existing merchant retention setting
with a dedicated test-data minimum/maximum policy. Deleting expired test
evidence never deletes its production order, payment, Webhook, or audit records.

## Migration and Runtime Parity

The forward migration:

1. adds rail network class and the explicitly supported testnet/simulator
   catalog rows;
2. creates test-run and callback-receipt tables and scope-leading indexes;
3. provisions missing sandbox bootstrap resources idempotently for existing
   merchants;
4. leaves all current production rows, rail codes, order URLs, API credentials,
   and callback deliveries unchanged;
5. verifies duplicate/orphan counts and query plans, then runs `PRAGMA optimize`.

The same schema, server functions, Queue behavior, scheduler recovery, and
callback handling work in Workers/D1 and Bun/SQLite. No test-center behavior is
guarded by `import.meta.env.DEV`.

## Verification

Focused automated coverage includes:

- schema, migration idempotency, sandbox bootstrap, and query-plan tests;
- GMPay and EPay signed test requests through their real handlers;
- API-secret redaction and confirmation-token replay/tamper/expiry tests;
- cross-merchant and cross-environment read/write/simulation attacks;
- simulator scenarios through payment ingestion, state transitions, outbox,
  callback receipt, duplicate handling, and reorganization recovery;
- mainnet/testnet/simulated rail readiness isolation;
- custom callback SSRF validation and Webhook retry evidence;
- light/dark, mobile/desktop, keyboard, locale, and route-selection coverage;
- Workers and Bun runtime adapter parity.

Retained real-provider smoke suites remain unconditionally skipped automated
assets. Manual evidence is required for configured testnets and for a controlled
production order with real funds.

After locally executable work is complete, run once on the same final tree:

```bash
bun run typecheck
bun run test
bun run check
bun run build
bun run build:bun
```

## Acceptance Scenarios

1. GMPay sandbox simulator creates an order, completes payment through the real
   state machine, delivers to the built-in callback, and marks the run passed.
2. EPay sandbox simulator creates an order, exercises a custom callback, shows
   its response and retries, and reaches the expected final result.
3. A configured first-release testnet receives a real transfer, scans and
   confirms it, changes the order, delivers the callback, and passes the run.
4. Production requires a valid one-time confirmation, creates a real mainnet
   order, and rejects every simulator endpoint before any mutation.
5. Two merchants with sandbox and production data cannot list, read, mutate,
   simulate, confirm, or retry each other's runs, orders, keys, payments, or
   callbacks.

## Implementation Phases

1. Persistence, environment-mode invariants, scoped authorization, and migration.
2. Simulator provider-event engine and built-in callback receiver.
3. Guided test, API console, history, timeline, and six-locale UI.
4. First-release testnet rail catalogs, adapter configuration, and readiness.
5. Security/e2e verification, Workers/Bun parity, migration rehearsal, release,
   and live sandbox/testnet/controlled-production evidence.

Each phase uses focused tests and a behavior-preserving simplification review.
No phase is complete until its server authorization and cross-scope security
tests pass.
