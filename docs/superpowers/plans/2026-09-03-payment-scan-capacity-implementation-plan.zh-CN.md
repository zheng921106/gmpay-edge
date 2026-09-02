# 支付扫描容量实施计划

> **供自动化执行者使用：** 必须按测试优先的检查点直接执行。本次变更及发布已获运营者明确授权，因此在当前会话内完成。

**目标：** 保证一笔订单的确认扫描始终单飞执行，对节点限流采用可预测的退避重试，并在队列重复投递时保留有价值的审计记录。

**架构：** 在 `orders` 增加短时、持久化的扫描租约。消费者在加载适配器前原子领取租约；重复消息不再调用节点而直接确认。持有者失败时仅释放自己的租约令牌后延迟重试。可重试的节点与配置错误使用封顶指数退避；同一订单、收款方式、错误类别的失败审计在退避窗口内合并。

**技术栈：** TypeScript、Cloudflare Queues、D1/SQLite、Drizzle Schema、Vitest、Miniflare、Wrangler。

**规范：** `AGENTS.zh-CN.md` 第 5、6、9、10 节。

## 全局约束

- 保持 GMPay/EPay 请求、收银台、确认阈值和支付状态机契约不变。
- D1 是唯一的原子协调来源；不得将租约或资金状态放入 KV。
- 新租约字段仅存储毫秒时间戳，节点错误继续脱敏。
- 队列工作必须有界且幂等；仅当订单 ID 与租约到期令牌都匹配时才允许释放租约。
- 先补充真实 D1 的聚焦测试，再执行完整质量门禁与生产发布。

---

### 任务 1：持久化订单扫描租约

**文件：**
- 新建：`drizzle/0012_payment_scan_lease.sql`
- 修改：`src/db/schema/payments.ts`
- 修改：`src/server/queue/payment-scan.ts`
- 修改：`src/server/queue/index.ts`
- 测试：`tests/integration/payment-scan-capacity.test.ts`

**接口：**
- 提供 `claimPaymentScanLease(db, orderId, nowMs): Promise<number | null>`。
- 提供 `releasePaymentScanLease(db, orderId, leaseUntilMs): Promise<void>`。
- `orders.payment_scan_lease_until` 是唯一的消费者所有权信号。

- [x] **步骤 1：编写失败测试**

```ts
const first = await claimPaymentScanLease(db, "order-a", 1_000);
const duplicate = await claimPaymentScanLease(db, "order-a", 1_000);

expect(first).toBe(61_000);
expect(duplicate).toBeNull();
```

- [x] **步骤 2：运行并确认测试失败**

运行：`bunx vitest run tests/integration/payment-scan-capacity.test.ts`

预期：因租约函数与数据库字段尚不存在而失败。

- [x] **步骤 3：添加迁移和最小实现**

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

- [x] **步骤 4：运行聚焦测试并确认通过**

运行：`bunx vitest run tests/integration/payment-scan-capacity.test.ts`

预期：通过首次领取、过期接管和精确令牌释放。

### 任务 2：有界重试与审计合并

**文件：**
- 修改：`src/server/queue/payment-scan.ts`
- 测试：`tests/integration/payment-scan-capacity.test.ts`

**接口：**
- 提供 `retryPaymentScan(message): void`，退避序列为 15、30、60、120、240、300 秒封顶。
- 使用 `Message.attempts` 与 Cloudflare Queue 的 `delaySeconds`。
- 同一 `payment.scan_failed` 在五分钟重试窗口内最多保留一条审计。

- [x] **步骤 1：编写失败测试**

```ts
const delays: number[] = [];
retryPaymentScan({ attempts: 3, retry: ({ delaySeconds }) => delays.push(delaySeconds) });

expect(delays).toEqual([60]);
```

- [x] **步骤 2：运行并确认测试失败**

运行：`bunx vitest run tests/integration/payment-scan-capacity.test.ts`

预期：当前支付扫描使用即时重试，因此测试失败。

- [x] **步骤 3：添加最小实现**

```ts
const delaySeconds = Math.min(300, 15 * 2 ** Math.min(4, Math.max(0, attempts - 1)));
message.retry({ delaySeconds });
```

使用带 `NOT EXISTS` 的原子 `INSERT ... SELECT`，以审计订单/时间索引约束节点故障时的审计写入量。

- [x] **步骤 4：运行聚焦测试并确认通过**

运行：`bunx vitest run tests/integration/payment-scan-capacity.test.ts`

预期：验证退避进度和重复审计合并。

### 任务 3：队列集成与发布证据

**文件：**
- 修改：`src/server/queue/payment-scan.ts`
- 测试：`tests/integration/payment-scan-capacity.test.ts`
- 测试：`tests/integration/query-plans.test.ts`

**接口：**
- `handlePaymentScan` 在调用配置或 RPC 前领取租约，确认重复投递，并在所有终止路径释放已拥有租约。
- 释放条件同时包含订单 ID 和租约到期令牌。

- [x] **步骤 1：增加失败的队列集成用例**

```ts
await Promise.all([handlePaymentScan(first, env), handlePaymentScan(duplicate, env)]);
expect(firstAcked + duplicateAcked).toBe(2);
expect(providerScans).toBe(1);
```

- [x] **步骤 2：运行并确认重复扫描会在租约实现前访问节点**

运行：`bunx vitest run tests/integration/payment-scan-capacity.test.ts`

预期：在消费者领取 D1 租约前失败。

- [x] **步骤 3：将租约接入所有队列终止路径**

将配置、故障转移、处理与重试分支包裹在 `try/finally` 中；只有赢得租约的消费者调用 `releasePaymentScanLease`。不可重试的节点错误仍直接确认。

- [x] **步骤 4：验证 D1 查询计划和完整发布门禁**

运行：

```bash
bun run typecheck
bun run test
bun run check
bun run build
bun run build:bun
bun run predeploy
```

预期：全部命令退出码为 `0`；查询计划测试确认扫描列表没有临时 B-tree，失败审计查询使用有界部分索引。

- [ ] **步骤 5：发布并验证生产环境**

```bash
git add drizzle src tests docs
git commit -m "fix: harden payment scan queue capacity"
git push origin main
PATH=/Users/zhengzhixing/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH bun run deploy
```

验证远端迁移已应用、Worker 版本已更新，并确认 `https://pay.gelooss.com/` 返回本次部署后的应用。
