# Payment Scan Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with test-first checkpoints. This release is executed directly because the operator explicitly authorized the production change and release.

**Goal:** Keep a payment order's confirmation scan single-flight, rate-limit retries predictably, and retain useful audit history when queue delivery repeats.

**Architecture:** Add a short-lived, durable lease to `orders`. A payment queue consumer atomically claims that lease before loading adapters; duplicates acknowledge without provider work, while a failed owner releases its exact lease before a delayed retry. Retryable provider and configuration failures use capped exponential backoff, and duplicate failure audits for the same order/method/reason are coalesced over the backoff window.

**Tech Stack:** TypeScript, Cloudflare Queues, D1/SQLite, Drizzle schema, Vitest, Miniflare, Wrangler.

**Spec:** `AGENTS.md`, sections 5, 6, 9, and 10.

## Global Constraints

- Preserve GMPay/EPay request, checkout, confirmation threshold, and payment-state contracts.
- Use D1 as the authoritative atomic coordination store; do not use KV for leases or payment state.
- Store only millisecond timestamps in the new lease field and keep all provider failures redacted.
- Keep queue work bounded and idempotent; a lease is released only when its exact expiry token still belongs to the current consumer.
- Add focused real-D1 tests before implementation, then run the complete required quality gate before release.

---

### Task 1: Durable Order Scan Lease

**Files:**
- Create: `drizzle/0012_payment_scan_lease.sql`
- Modify: `src/db/schema/payments.ts`
- Modify: `src/server/queue/payment-scan.ts`
- Modify: `src/server/queue/index.ts`
- Test: `tests/integration/payment-scan-capacity.test.ts`

**Interfaces:**
- Produces `claimPaymentScanLease(db, orderId, nowMs): Promise<number | null>`.
- Produces `releasePaymentScanLease(db, orderId, leaseUntilMs): Promise<void>`.
- Consumes `orders.payment_scan_lease_until` as the only queue ownership signal.

- [x] **Step 1: Write the failing test**

```ts
const first = await claimPaymentScanLease(db, "order-a", 1_000);
const duplicate = await claimPaymentScanLease(db, "order-a", 1_000);

expect(first).toBe(61_000);
expect(duplicate).toBeNull();
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/integration/payment-scan-capacity.test.ts`

Expected: FAIL because the lease functions and database column do not exist.

- [x] **Step 3: Add the migration and implementation**

```sql
ALTER TABLE `orders` ADD `payment_scan_lease_until` integer;
CREATE INDEX `audit_logs_payment_scan_failure_idx`
  ON `audit_logs` (`target_id`,`created_at`,`id`)
  WHERE `action` = 'payment.scan_failed' AND `target_type` = 'order';
```

```ts
const leaseUntilMs = nowMs + 60_000;
const claim = await db.prepare(
  `UPDATE orders SET payment_scan_lease_until = ?
   WHERE id = ? AND (payment_scan_lease_until IS NULL
   OR payment_scan_lease_until <= ?)`,
).bind(leaseUntilMs, orderId, nowMs).run();
return claim.meta.changes === 1 ? leaseUntilMs : null;
```

- [x] **Step 4: Run the focused test to verify it passes**

Run: `bunx vitest run tests/integration/payment-scan-capacity.test.ts`

Expected: PASS, including expired-lease takeover and exact-token release.

### Task 2: Bounded Retry and Audit Coalescing

**Files:**
- Modify: `src/server/queue/payment-scan.ts`
- Test: `tests/integration/payment-scan-capacity.test.ts`

**Interfaces:**
- Produces `retryPaymentScan(message): void` with a 15, 30, 60, 120, 240, 300-second capped progression.
- Consumes `Message.attempts` and Cloudflare Queue `delaySeconds`.
- Retains at most one identical `payment.scan_failed` audit within a five-minute retry window.

- [x] **Step 1: Write the failing test**

```ts
const delays: number[] = [];
retryPaymentScan({ attempts: 3, retry: ({ delaySeconds }) => delays.push(delaySeconds) });

expect(delays).toEqual([60]);
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/integration/payment-scan-capacity.test.ts`

Expected: FAIL because payment scans currently retry immediately.

- [x] **Step 3: Add the minimal implementation**

```ts
const delaySeconds = Math.min(300, 15 * 2 ** Math.min(4, Math.max(0, attempts - 1)));
message.retry({ delaySeconds });
```

Use an atomic `INSERT ... SELECT ... WHERE NOT EXISTS` against the indexed audit order/time columns so a provider outage does not create an unbounded audit write stream.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `bunx vitest run tests/integration/payment-scan-capacity.test.ts`

Expected: PASS for retry progression and duplicate-audit coalescing.

### Task 3: Queue Integration and Release Evidence

**Files:**
- Modify: `src/server/queue/payment-scan.ts`
- Test: `tests/integration/payment-scan-capacity.test.ts`
- Test: `tests/integration/query-plans.test.ts`

**Interfaces:**
- `handlePaymentScan` claims before provider configuration or RPC calls, acknowledges duplicate deliveries, and releases the owned lease on every terminal path.
- The release condition includes both order ID and lease expiry token.

- [x] **Step 1: Add the failing queue integration case**

```ts
await Promise.all([handlePaymentScan(first, env), handlePaymentScan(duplicate, env)]);
expect(firstAcked + duplicateAcked).toBe(2);
expect(providerScans).toBe(1);
```

- [x] **Step 2: Run it to verify the duplicate scan reaches the provider before the lease exists**

Run: `bunx vitest run tests/integration/payment-scan-capacity.test.ts`

Expected: FAIL until the queue consumer claims the D1 lease.

- [x] **Step 3: Integrate the lease with all queue terminal paths**

Wrap configuration, failover, processing, and retry exits in `try/finally`; call `releasePaymentScanLease` only when the consumer won the lease. Keep non-retryable provider failures acknowledged.

- [x] **Step 4: Validate D1 plans and the complete release gate**

Run:

```bash
bun run typecheck
bun run test
bun run check
bun run build
bun run build:bun
bun run predeploy
```

Expected: all commands exit `0`; query-plan tests show no temporary B-tree for the scan list and the failure-audit lookup uses its bounded partial index.

- [x] **Step 5: Release and verify production**

```bash
git add drizzle src tests docs
git commit -m "fix: harden payment scan queue capacity"
git push origin main
PATH=/Users/zhengzhixing/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH bun run deploy
```

Verify the remote migration is applied, the Worker version is current, and `https://pay.gelooss.com/` returns the deployed application.
