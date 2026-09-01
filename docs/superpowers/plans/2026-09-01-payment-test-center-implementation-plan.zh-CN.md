# GMPay Edge 支付测试中心实施计划

> **供智能执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项实施。本计划使用复选框（`- [ ]`）跟踪步骤。

**目标：** 交付一个经过认证、区分沙盒与生产环境的支付测试中心。它通过真实 GMPay/EPay 商户协议处理器创建订单，通过真实支付状态机完成沙盒模拟或已配置测试网支付，验证 Webhook 回调确认，并可在二次确认后安全发起生产订单。

**架构：** 在现有支付和 Webhook 所有权边界内新增持久化 `payment_test_run` 聚合。服务端编排构造并签名真实协议 `Request`，调用现有 GMPay/EPay 处理器，再把现有订单、支付、审计、Webhook 与回调记录组合成一条时间线。沙盒模拟事件实现现有 `PaymentAdapter`/`NormalizedTransaction` 契约；生产环境不接受任何模拟操作。路由保持轻量，只挂载同域的 `payment-testing` 功能。

**技术栈：** Bun、严格 TypeScript、React 19、TanStack Start/Router/Query/Form/Table、Tailwind CSS 4、shadcn/Radix、Zod、Better Auth、Drizzle、Cloudflare Workers D1/KV/R2/Queues/Cron、Bun/SQLite、Paraglide、Vitest、Biome、Wrangler。

**规格：** `docs/superpowers/specs/2026-09-01-payment-test-center-design.md` 与 `docs/superpowers/specs/2026-09-01-payment-test-center-design.zh-CN.md`

## 全局约束

- 保持现有 GMPay/EPay 公共 API 路径、负载、签名、订单服务、状态机、Webhook outbox、重试策略和结账行为不变。
- 每个测试操作都在服务端解析已认证的商户/环境上下文；提交的运行、订单、API Key、收款方式和回调 ID 在使用前必须重新校验范围。
- 沙盒只接受 `simulated` 和 `testnet` 支付轨道，生产只接受 `mainnet`；生产模拟请求必须在任何数据库或 Queue 变更前失败。
- API Secret 只在构造和签名协议请求期间解密，不得进入响应、测试快照、KV、审计或日志。
- 模拟场景只生成 `NormalizedTransaction` 并调用 `recordPaymentTransaction`，不得直接写订单状态。
- 测试网和生产收款目标必须是商户提供的公开地址；不得生成或保存私钥、助记词或提现凭证。
- 金额使用十进制整数字符串，时间戳使用毫秒，JSON 快照有界并经过结构校验，错误使用结构化领域错误，索引以作用域列开头。
- 复用 Better Auth、商户 RBAC、Drizzle、ProForm、ProTable、Paraglide、导航权威、运行时适配器与现有设计 token；不得增加第二套框架或通用透传层。
- 所有界面文字必须同时写入 `en-US`、`ja-JP`、`ko-KR`、`ru-RU`、`zh-TW`、`zh-CN`。
- 每个非平凡任务后，对触及差异执行保持行为的简化审查；全部任务完成后才运行一次完整质量门。

## 权威契约

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

`payment_mode` 与轨道类型的映射固定为：`simulator -> simulated`、`testnet -> testnet`、`live -> mainnet`。预检、收款方式就绪检查、场景执行和生产确认必须调用同一个纯函数完成环境校验。

## 文件地图

- `src/db/schema/payments.ts`：轨道网络类型和 `paymentTestRuns`。
- `src/db/schema/webhooks.ts`：`paymentTestCallbackReceipts` 与回调尝试关联。
- `drizzle/0011_payment_test_center.sql`、`drizzle/meta/_journal.json`：前向迁移、目录和存量沙盒补齐。
- `src/features/payment-testing/schema.ts`、`types.ts`：Zod 边界与稳定类型。
- `src/features/payment-testing/server/{preflight,protocol-request,runs,confirmation,simulator,callback,timeline,functions}.ts`：功能编排。
- `src/integrations/chains/simulator.ts`：复用现有链类型的运行时模拟适配器。
- `src/features/payment-settings/{catalog,readiness}.ts` 与 `server/{check-method-readiness,method-adapter}.ts`：网络类型目录和就绪校验。
- `src/features/auth/server/registration.ts`、`src/features/merchants/server/{platform,payment-ingresses}.ts`：新商户原子沙盒初始化。
- `src/features/payment-testing/pages/*`：引导测试、API 控制台、历史和运行详情。
- `src/routes/admin/test-center/*`、`src/routes/api/test-callbacks/$token.ts`：轻量语义路由。
- `src/layouts/components/data/sidebar-data.ts`：共享导航与访问映射。
- `messages/*.json`：六语种文案。
- `tests/{unit,integration,security,e2e}/payment-testing/*`：契约、隔离、流程、主题与运行时测试。
- `docs/PAYMENT_TESTING.md`、`docs/PAYMENT_TESTING.zh-CN.md`：运维和商户文档。

---

### 任务 1：增加持久化、索引和前向迁移

**文件：**
- 修改：`src/db/schema/payments.ts`
- 修改：`src/db/schema/webhooks.ts`
- 新建：`drizzle/0011_payment_test_center.sql`
- 修改：`drizzle/meta/_journal.json`
- 测试：`tests/unit/payment-testing/schema-contract.test.ts`
- 测试：`tests/integration/payment-testing/migration.test.ts`
- 修改：`tests/integration/query-plans.test.ts`

**接口：**
- 为 `payment_rails` 增加非空 `network_class`，迁移时现有轨道统一写为 `mainnet`。
- 新增 `payment_test_runs`，包含作用域幂等键、可空唯一订单关联、脱敏快照、生产确认 nonce 状态、回调 token 哈希、结果状态和时间戳。
- 新增 `payment_test_callback_receipts`，保存运行/事件/投递/尝试身份、签名结果、有界脱敏请求证据、确认响应与时间戳。

- [ ] **步骤 1：先写失败的 Schema 与迁移测试**

精确断言枚举、外键、检查约束、订单部分唯一索引、`(merchant_id, environment_id, created_at, id)` 历史索引、活跃运行索引以及 `(delivery_id, attempt)` 回调唯一键。分别在空数据库和包含旧轨道/订单的数据库执行全迁移，断言旧轨道成为 `mainnet`、生产记录 ID 不变、重复执行迁移登记不会生成重复初始化数据。

- [ ] **步骤 2：运行聚焦测试并确认失败**

```bash
bunx vitest run tests/unit/payment-testing/schema-contract.test.ts tests/integration/payment-testing/migration.test.ts
```

预期：失败，因为 `paymentRails.networkClass`、`paymentTestRuns`、`paymentTestCallbackReceipts` 和 `0011_payment_test_center.sql` 尚不存在。

- [ ] **步骤 3：实现 Drizzle Schema**

快照使用有界结构类型，不保存未解析字符串：

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

运行唯一键为 `(merchant_id, environment_id, protocol, api_key_id, idempotency_key)`；`order_id` 仅在非空时唯一。只保存 `callback_destination_snapshot`，原始自定义回调 URL 继续由订单现有 notify URL 契约验证和保存。生产确认 token 与内置回调 token 只保存 SHA-256 哈希。

- [ ] **步骤 4：编写 `0011_payment_test_center.sql`**

仅在 SQLite 非空/检查约束需要时重建 `payment_rails`，保留全部 code 和时间戳。创建两张表和索引，以 `INSERT OR IGNORE` 写入任务 2 定义的模拟器/测试网全局目录。SQL 不得伪造加密 API Key Secret；存量商户 Key 和收款资源由任务 3 在 Schema 迁移后通过运行时幂等 reconcile 补齐。确认孤儿与重复查询均为零，最后执行 `PRAGMA optimize`。只更新 `_journal.json`，不得手写 Drizzle 未生成的 snapshot。

- [ ] **步骤 5：验证 Schema、迁移和查询计划**

```bash
bunx vitest run tests/unit/payment-testing/schema-contract.test.ts tests/integration/payment-testing/migration.test.ts tests/integration/query-plans.test.ts
bunx biome check src/db/schema/payments.ts src/db/schema/webhooks.ts tests/unit/payment-testing/schema-contract.test.ts tests/integration/payment-testing/migration.test.ts tests/integration/query-plans.test.ts
git diff --check
```

预期：全部通过；历史和活跃运行查询使用作用域索引；孤儿与重复记录均为零。

- [ ] **步骤 6：提交**

```bash
git add src/db/schema/payments.ts src/db/schema/webhooks.ts drizzle/0011_payment_test_center.sql drizzle/meta/_journal.json tests/unit/payment-testing/schema-contract.test.ts tests/integration/payment-testing/migration.test.ts tests/integration/query-plans.test.ts
git commit -m "feat: add payment test run persistence"
```

### 任务 2：强制轨道网络类型并加入首批测试网

**文件：**
- 修改：`src/features/payment-settings/catalog.ts`
- 修改：`src/features/payment-settings/readiness.ts`
- 修改：`src/features/payment-settings/server/check-method-readiness.ts`
- 修改：`src/features/payment-settings/server/method-adapter.ts`
- 修改：`src/integrations/chains/types.ts`
- 修改：`src/integrations/chains/evm.ts`
- 修改：`src/integrations/chains/tron.ts`
- 新建：`src/integrations/chains/simulator.ts`
- 测试：`tests/unit/payment-settings/catalog.test.ts`
- 测试：`tests/unit/payment-testing/environment-capabilities.test.ts`
- 测试：`tests/integration/payment-testing/testnet-readiness.test.ts`

**接口：** 新增独立轨道 `simulator`、`tron-nile`、`ethereum-sepolia`、`base-sepolia`、`bsc-testnet`、`polygon-amoy`，并导出 `assertPaymentModeAllowed(environmentCode, paymentMode, networkClass): void`。

- [ ] **步骤 1：写失败的目录与能力矩阵测试**

覆盖每个允许/拒绝的环境、模式、网络类型组合。测试网轨道不得复用主网 code，模拟器不要求外部连接，没有明确测试环境的交易所/钱包轨道不得出现在沙盒真实测试网选项中。

- [ ] **步骤 2：确认失败**

```bash
bunx vitest run tests/unit/payment-settings/catalog.test.ts tests/unit/payment-testing/environment-capabilities.test.ts tests/integration/payment-testing/testnet-readiness.test.ts
```

预期：失败，因为轨道尚无 `networkClass`，运行时适配器也不认识新网络身份。

- [ ] **步骤 3：实现唯一环境不变量**

```ts
export function assertPaymentModeAllowed(
  environment: "sandbox" | "production",
  mode: "simulator" | "testnet" | "live",
  networkClass: "simulated" | "testnet" | "mainnet",
): void;
```

错误码固定为 `payment_mode_environment_mismatch` 与 `payment_rail_class_mismatch`。就绪检查、开始运行、场景推进、真实支付刷新和生产确认都调用它。

- [ ] **步骤 4：加入已核实的原生资产测试网目录**

本期只加入原生资产：Nile 的 TRX、Ethereum Sepolia/Base Sepolia 的 ETH、BSC Testnet 的 BNB、Polygon Amoy 的 POL。

| 轨道 | Chain ID | 默认公共端点 |
| --- | ---: | --- |
| `tron-nile` | Nile | `https://nile.trongrid.io` |
| `ethereum-sepolia` | `11155111` | 不预置，运维配置服务商或自建节点 |
| `base-sepolia` | `84532` | `https://sepolia.base.org` |
| `bsc-testnet` | `97` | `https://bsc-testnet-dataseed.bnbchain.org` |
| `polygon-amoy` | `80002` | `https://rpc-amoy.polygon.technology` |

未经单独核验不得添加代币合约地址。Ethereum Sepolia 功能可用，但只有运维配置健康端点后才进入 ready。来源：[TRON 网络](https://developers.tron.network/docs/networks)、[Ethereum 网络](https://geth.ethereum.org/docs/fundamentals/private-network)、[Base 网络信息](https://docs.base.org/base-chain/quickstart/connecting-to-base)、[BNB Smart Chain RPC](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/)、[Polygon Amoy 工具](https://docs.polygon.technology/tools/dApp-development/common-tools/remix/)。

- [ ] **步骤 5：实现适配器区分和就绪检查**

EVM/TRON 适配器接收目录网络身份和预期 chain ID，RPC 返回其他网络时健康检查失败。模拟适配器实现 `PaymentAdapter` 但不发起网络 I/O，只有任务 5 可以向它提供观察事件。就绪结果明确返回缺少连接、连接不健康、缺少地址和环境不匹配原因。

- [ ] **步骤 6：验证并提交**

```bash
bunx vitest run tests/unit/payment-settings/catalog.test.ts tests/unit/payment-testing/environment-capabilities.test.ts tests/integration/payment-testing/testnet-readiness.test.ts
bunx biome check src/features/payment-settings/catalog.ts src/features/payment-settings/readiness.ts src/features/payment-settings/server/check-method-readiness.ts src/features/payment-settings/server/method-adapter.ts src/integrations/chains/types.ts src/integrations/chains/evm.ts src/integrations/chains/tron.ts src/integrations/chains/simulator.ts tests/unit/payment-settings/catalog.test.ts tests/unit/payment-testing/environment-capabilities.test.ts tests/integration/payment-testing/testnet-readiness.test.ts
git add src/features/payment-settings src/integrations/chains tests/unit/payment-settings/catalog.test.ts tests/unit/payment-testing/environment-capabilities.test.ts tests/integration/payment-testing/testnet-readiness.test.ts
git commit -m "feat: classify rails and add sandbox testnets"
```

### 任务 3：为每个商户创建可直接运行的沙盒

**文件：**
- 新建：`src/features/payment-testing/server/bootstrap.ts`
- 修改：`src/features/auth/server/registration.ts`
- 修改：`src/features/merchants/server/platform.ts`
- 修改：`src/features/merchants/server/payment-ingresses.ts`
- 修改：`src/features/installation/server/reconcile-payment-infrastructure.ts`
- 测试：`tests/integration/tenant/registration.test.ts`
- 测试：`tests/integration/tenant/platform-merchant.test.ts`
- 修改：`tests/integration/tenant/merchant-bootstrap.test.ts`

**接口：** 导出 `buildSandboxTestBootstrap(input): SandboxTestBootstrapStatements`，同时服务 Drizzle batch 与原生 D1 batch，并导出供存量商户使用的 `ensureSandboxTestBootstrap(db, context)`。创建一个启用的沙盒 Key，权限为 `orders:create`、`orders:read`、`orders:update`、`assets:read`；创建模拟收款方式，并从作用域初始化资源推导一个可直接运行的示例预设，不创建 preset 表或订单。

- [ ] **步骤 1：扩展初始化测试并确认失败**

自助注册和平台创建商户都必须原子创建且只创建一个沙盒测试 Key、模拟 ingress/收款方式/资产绑定、内置回调能力和可推导的示例预设。生产环境不得获得这些模拟资源，重复运行时 reconcile 不得产生重复数据。迁移后的存量商户在首次授权 reconcile 后获得相同资源。

```bash
bunx vitest run tests/integration/tenant/registration.test.ts tests/integration/tenant/platform-merchant.test.ts tests/integration/tenant/merchant-bootstrap.test.ts
```

- [ ] **步骤 2：实现共享初始化构造器**

使用现有 Key 生成器和运行时 pepper 加密 Secret；明文只从已有的一次性入驻结果返回。使用稳定的作用域资源名和唯一约束作为 reconcile 标记，使重试可补齐资源但不会轮换已有 Key。存量商户在加载默认预设前完成 reconcile，Secret 只保留在服务端。Ingress 初始化参数改为 `{ id, code }`，沙盒过滤主网默认连接。

- [ ] **步骤 3：接入两条商户创建路径和 reconcile**

保持现有单次 D1/Drizzle batch。Reconcile 仅填充不存在的模拟资源并保留商户修改。示例预设从初始化 Key 与收款方式动态计算，不含 Secret、不写数据库，也不创建订单。认证后的测试中心 loader 和安装基础设施 reconcile 都调用该逻辑，使 Workers/D1 与 Bun/SQLite 收敛。

- [ ] **步骤 4：验证并提交**

```bash
bunx vitest run tests/integration/tenant/registration.test.ts tests/integration/tenant/platform-merchant.test.ts tests/integration/tenant/merchant-bootstrap.test.ts
bunx biome check src/features/payment-testing/server/bootstrap.ts src/features/auth/server/registration.ts src/features/merchants/server/platform.ts src/features/merchants/server/payment-ingresses.ts src/features/installation/server/reconcile-payment-infrastructure.ts tests/integration/tenant/registration.test.ts tests/integration/tenant/platform-merchant.test.ts tests/integration/tenant/merchant-bootstrap.test.ts
git add src/features/payment-testing/server/bootstrap.ts src/features/auth/server/registration.ts src/features/merchants/server/platform.ts src/features/merchants/server/payment-ingresses.ts src/features/installation/server/reconcile-payment-infrastructure.ts tests/integration/tenant
git commit -m "feat: bootstrap merchant payment sandbox"
```

### 任务 4：实现预检、真实协议请求和生产二次确认

**文件：**
- 新建：`src/features/payment-testing/schema.ts`
- 新建：`src/features/payment-testing/types.ts`
- 新建：`src/features/payment-testing/server/preflight.ts`
- 新建：`src/features/payment-testing/server/protocol-request.ts`
- 新建：`src/features/payment-testing/server/runs.ts`
- 新建：`src/features/payment-testing/server/confirmation.ts`
- 测试：`tests/integration/payment-testing/protocol-run.test.ts`
- 测试：`tests/security/payment-testing/production-confirmation.test.ts`
- 测试：`tests/security/payment-testing/scope-isolation.test.ts`

**接口：**

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

- [ ] **步骤 1：写真实签名协议测试**

GMPay 与 EPay 都创建有作用域的 Key，断言测试中心构造真实 `Request`，调用 `handleGmpayCreateRequest` 或 `handleEpayCreateRequest`，覆盖认证、限流、幂等并把订单关联到运行；持久化只能保存脱敏快照。原始控制台输入先通过现有协议 Schema，再签名。

- [ ] **步骤 2：写生产 token 和隔离攻击测试**

覆盖篡改、过期、重用、换用户、换商户/环境、修改金额/网络/回调、生产模拟、沙盒主网，以及跨作用域 run/key/method ID。所有失败都必须发生在创建订单之前并返回结构化通用错误。

- [ ] **步骤 3：确认测试失败**

```bash
bunx vitest run tests/integration/payment-testing/protocol-run.test.ts tests/security/payment-testing/production-confirmation.test.ts tests/security/payment-testing/scope-isolation.test.ts
```

- [ ] **步骤 4：实现边界 Schema 与预检**

使用 Zod 一次验证协议、模式、Key、收款方式、minor 金额字符串、币种、资产、返回 URL、回调选择和客户端幂等键。预检在当前作用域加载选中行，调用共享就绪/环境不变量，复用 HTTPS/DNS/SSRF 规则检查自定义回调，确认 Queue binding，并返回稳定原因码。

- [ ] **步骤 5：调用真实协议处理器**

仅在请求生命周期解密 Secret，构造规范 GMPay JSON 或 EPay 表单/查询参数，使用现有签名函数签名，再直接调用现有 handler 和 `createOrder` 依赖。只解析 handler 的公开响应。保存脱敏签名输入、请求/响应、状态、耗时和 request ID；`signature`、`sign`、cookie、authorization、token 类值统一替换为 `[REDACTED]`。

- [ ] **步骤 6：实现一次性生产确认**

Token HMAC 绑定 run/user/merchant/environment/protocol/key/amount/currency/asset/network/callback digest/expiry/nonce。数据库只存 nonce 哈希和过期时间。使用单条条件更新原子消费；只有获胜请求能调用协议处理器。消费后、创建订单前再次验证环境不变量。

- [ ] **步骤 7：验证并提交**

```bash
bunx vitest run tests/integration/payment-testing/protocol-run.test.ts tests/security/payment-testing/production-confirmation.test.ts tests/security/payment-testing/scope-isolation.test.ts tests/integration/gmpay-authentication.test.ts tests/integration/epay-create-handler.test.ts
bunx biome check src/features/payment-testing tests/integration/payment-testing/protocol-run.test.ts tests/security/payment-testing
git add src/features/payment-testing/schema.ts src/features/payment-testing/types.ts src/features/payment-testing/server/preflight.ts src/features/payment-testing/server/protocol-request.ts src/features/payment-testing/server/runs.ts src/features/payment-testing/server/confirmation.ts tests/integration/payment-testing/protocol-run.test.ts tests/security/payment-testing
git commit -m "feat: create signed payment test runs"
```

### 任务 5：让模拟场景进入真实支付入账流程

**文件：**
- 新建：`src/features/payment-testing/server/simulator.ts`
- 修改：`src/integrations/chains/simulator.ts`
- 修改：`src/features/orders/server/admin.ts`
- 测试：`tests/integration/payment-testing/simulator-scenarios.test.ts`
- 修改：`tests/integration/payment-flow.test.ts`
- 测试：`tests/security/payment-testing/simulator-access.test.ts`

**接口：**

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

- [ ] **步骤 1：写场景与权限失败测试**

覆盖确定性的 `(runId, scenario, step)` 交易身份、部分/补齐、超付、确认数变化、失败交易、重复幂等、过期/迟付、reorg 回滚与恢复、回调失败准备。生产环境、非 mock 快照、非法步骤、跨作用域和缺少 `merchant:update` 必须在支付变更前失败。

- [ ] **步骤 2：确认失败**

```bash
bunx vitest run tests/integration/payment-testing/simulator-scenarios.test.ts tests/security/payment-testing/simulator-access.test.ts
```

- [ ] **步骤 3：实现确定性支付观察**

加载当前作用域的 run/order/payment snapshot，校验 sandbox + simulator + simulated rail + mock adapter，然后由场景表生成 `NormalizedTransaction`。金额使用 `amountUnits`，明确 confirmations、canonical、block、success 和确定性 hash。每个观察都调用 `recordPaymentTransaction`，订单状态、审计和 Webhook 由现有流程决定。

- [ ] **步骤 4：隔离任意状态修改入口**

只有剩余本地测试需要时才保留 `createDevelopmentOrderFn` 和 `simulateDevelopmentOrderStatusFn`，并继续限定 `import.meta.env.DEV`。测试中心统一走 `advanceSimulatorScenario`，不得扩大现有平台 mock 操作。删除代码前必须用 `rg` 和聚焦测试证明没有消费者。

- [ ] **步骤 5：验证并提交**

```bash
bunx vitest run tests/integration/payment-testing/simulator-scenarios.test.ts tests/security/payment-testing/simulator-access.test.ts tests/integration/payment-flow.test.ts
bunx biome check src/features/payment-testing/server/simulator.ts src/integrations/chains/simulator.ts src/features/orders/server/admin.ts tests/integration/payment-testing/simulator-scenarios.test.ts tests/security/payment-testing/simulator-access.test.ts tests/integration/payment-flow.test.ts
git add src/features/payment-testing/server/simulator.ts src/integrations/chains/simulator.ts src/features/orders/server/admin.ts tests/integration/payment-testing/simulator-scenarios.test.ts tests/security/payment-testing/simulator-access.test.ts tests/integration/payment-flow.test.ts
git commit -m "feat: add payment simulator scenarios"
```

### 任务 6：增加内置回调接收器和证据时间线

**文件：**
- 新建：`src/features/payment-testing/server/callback.ts`
- 新建：`src/features/payment-testing/server/timeline.ts`
- 新建：`src/routes/api/test-callbacks/$token.ts`
- 修改：`src/features/webhooks/types.ts`
- 修改：`src/features/webhooks/server/delivery.ts`
- 修改：`src/features/webhooks/server/consumer.ts`
- 测试：`tests/integration/payment-testing/builtin-callback.test.ts`
- 测试：`tests/integration/payment-testing/timeline.test.ts`
- 修改：`tests/integration/webhook-consumer.test.ts`
- 测试：`tests/security/payment-testing/callback-security.test.ts`

**接口：** 内置回调路径为 `/api/test-callbacks/:token`，token 为 256 位随机值，仅出现在 notify URL；导出 `handlePaymentTestCallback(request, env): Promise<Response>` 和 `loadPaymentTestTimeline(db, context, runId): Promise<PaymentTestTimeline>`。

- [ ] **步骤 1：写接收、重试与时间线失败测试**

覆盖有效 GMPay `ok`、EPay `success`、无效/过期 token、无效签名、超限 body、重复投递尝试、回调重试、自定义回调证据和跨商户 run。无效 token 使用同一个响应且不泄露 run 是否存在。时间线按时间和稳定事件优先级确定排序。

- [ ] **步骤 2：确认失败**

```bash
bunx vitest run tests/integration/payment-testing/builtin-callback.test.ts tests/integration/payment-testing/timeline.test.ts tests/integration/webhook-consumer.test.ts tests/security/payment-testing/callback-security.test.ts
```

- [ ] **步骤 3：实现有界签名回调处理**

对 path token 哈希，加载未过期的 running run，按现有 Webhook body 上限读取并用 run 所属 Key 验证 GMPay/EPay 签名，比较使用常量时间函数。保存脱敏头/body、event ID、delivery ID、attempt、签名状态、确认响应和接收时间。投递请求增加 `x-gmpay-attempt`，不改变现有 attempt 在网络请求完成后入库的顺序。

- [ ] **步骤 4：只允许实例自有回调目标绕过公网 URL 规则**

商户自定义 URL 继续执行现有 HTTPS/DNS/SSRF 校验。新增窄分支，只识别权威实例 origin 与有效未过期 run token 组成的 URL；不得允许任意 loopback/private URL，也不得全局放宽 `isSafeWebhookUrl`。Workers 与 Bun 均需覆盖。

- [ ] **步骤 5：组合证据并计算通过/失败**

作用域 run 联接订单快照、支付、区块记录、审计、Webhook event/delivery/attempt 和 callback receipt，不复制这些状态。只有明确期望订单状态和所需回调成功都出现时才 passed；可重试回调保持 running，终止错误写结构化 failure code。

- [ ] **步骤 6：验证并提交**

```bash
bunx vitest run tests/integration/payment-testing/builtin-callback.test.ts tests/integration/payment-testing/timeline.test.ts tests/integration/webhook-consumer.test.ts tests/security/payment-testing/callback-security.test.ts
bunx biome check src/features/payment-testing/server/callback.ts src/features/payment-testing/server/timeline.ts 'src/routes/api/test-callbacks/$token.ts' src/features/webhooks/types.ts src/features/webhooks/server/delivery.ts src/features/webhooks/server/consumer.ts tests/integration/payment-testing tests/integration/webhook-consumer.test.ts tests/security/payment-testing/callback-security.test.ts
git add src/features/payment-testing/server/callback.ts src/features/payment-testing/server/timeline.ts 'src/routes/api/test-callbacks/$token.ts' src/features/webhooks tests/integration/payment-testing tests/integration/webhook-consumer.test.ts tests/security/payment-testing/callback-security.test.ts
git commit -m "feat: close payment test callback loop"
```

### 任务 7：提供授权服务函数和语义路由

**文件：**
- 新建：`src/features/payment-testing/server/functions.ts`
- 新建：`src/routes/admin/test-center/route.tsx`
- 新建：`src/routes/admin/test-center/index.tsx`
- 新建：`src/routes/admin/test-center/console.tsx`
- 新建：`src/routes/admin/test-center/runs.tsx`
- 新建：`src/routes/admin/test-center/runs/$runId.tsx`
- 修改：`src/layouts/components/data/sidebar-data.ts`
- 修改：`src/routes/admin/route.tsx`
- 测试：`tests/security/server-entry-authorization.test.ts`
- 修改：`tests/unit/admin-route-navigation.test.ts`
- 修改：`tests/unit/layouts/merchant-sidebar.test.ts`

**权限接口：** `merchant:read` 用于列表/详情；`merchant:create` 用于预检/发起/生产确认；`merchant:update` 用于推进模拟、刷新真实支付、重试 Webhook 与取消运行。

- [ ] **步骤 1：写服务入口与导航失败测试**

每个 server function 必须使用上述精确权限，验证选中上下文并拒绝跨作用域 ID。拥有 read 权限的商户用户可以访问 `/admin/test-center`、`/console`、`/runs`、`/runs/:runId`；平台 root 也必须先选定具体商户/环境。

- [ ] **步骤 2：确认失败**

```bash
bunx vitest run tests/security/server-entry-authorization.test.ts tests/unit/admin-route-navigation.test.ts tests/unit/layouts/merchant-sidebar.test.ts
```

- [ ] **步骤 3：实现服务函数边界**

使用 `createServerFn`、`payment-testing/schema.ts` 的 Zod validator、`getRequest`、`getDb` 与 `requireMerchantAccess`。路由/loader 只处理参数、搜索、访问和挂载。历史按 `(created_at, id)` 有界 cursor 分页，不返回原始 token、Secret、未脱敏快照、堆栈或其他作用域是否存在的信息。

- [ ] **步骤 4：增加语义路由和共享导航权威**

测试中心放在现有 integrations 组。引导、控制台、历史、详情使用真实路由文件，不使用 query 参数模拟子路由。侧栏、命令菜单、默认子页、激活选择和访问检查都来自同一导航条目。

- [ ] **步骤 5：生成路由、验证并提交**

```bash
bun run generate-routes
bunx vitest run tests/security/server-entry-authorization.test.ts tests/unit/admin-route-navigation.test.ts tests/unit/layouts/merchant-sidebar.test.ts
bunx biome check src/features/payment-testing/server/functions.ts src/routes/admin/test-center src/layouts/components/data/sidebar-data.ts src/routes/admin/route.tsx tests/security/server-entry-authorization.test.ts tests/unit/admin-route-navigation.test.ts tests/unit/layouts/merchant-sidebar.test.ts
git add src/features/payment-testing/server/functions.ts src/routes/admin/test-center src/layouts/components/data/sidebar-data.ts src/routes/admin/route.tsx src/routeTree.gen.ts tests/security/server-entry-authorization.test.ts tests/unit/admin-route-navigation.test.ts tests/unit/layouts/merchant-sidebar.test.ts
git commit -m "feat: expose payment test center routes"
```

### 任务 8：构建引导测试、API 控制台、历史和时间线界面

**文件：**
- 新建：`src/features/payment-testing/pages/guided-test.tsx`
- 新建：`src/features/payment-testing/pages/api-console.tsx`
- 新建：`src/features/payment-testing/pages/history.tsx`
- 新建：`src/features/payment-testing/pages/run-detail.tsx`
- 新建：`src/features/payment-testing/components/environment-boundary.tsx`
- 新建：`src/features/payment-testing/components/run-timeline.tsx`
- 修改：`messages/en-US.json`、`ja-JP.json`、`ko-KR.json`、`ru-RU.json`、`zh-TW.json`、`zh-CN.json`
- 测试：`tests/unit/payment-testing/pages.test.tsx`
- 测试：`tests/e2e/payment-test-center.spec.ts`

- [ ] **步骤 1：写组件和浏览器失败测试**

覆盖沙盒默认模拟器、协议切换、生产二次确认内容、键盘遍历、错误关联、焦点恢复、上下文切换失效、分页、时间线状态、Secret 脱敏、移动响应式、减少动画和浅/深色语义对比。生产 UI 不显示模拟控件，服务端拒绝另有安全测试。

- [ ] **步骤 2：确认组件测试失败**

```bash
bunx vitest run tests/unit/payment-testing/pages.test.tsx
```

- [ ] **步骤 3：实现引导流程**

使用 ProForm 收集协议、模式、Key、金额、币种、资产、轨道、返回 URL 和回调，内联展示预检。生产确认必须列出商户、金额、币种、资产、网络、回调目标和本地化“真实资金”，再消费短期 token。创建后展示结账、查询、下一场景/检查动作和实时状态，不加入营销说明文案。

- [ ] **步骤 4：实现控制台、历史和详情**

使用 GMPay/EPay 分段控件与结构化/原始视图 tabs，显示 endpoint、method、PID、规范签名输入、脱敏签名/请求、状态、响应、request ID 和耗时。历史使用 ProTable 内置刷新。时间线用图标与文字表达，浅/深色使用独立语义 token，不嵌套卡片。

- [ ] **步骤 5：增加六语种并重新生成 Paraglide/路由**

六个 JSON 的 message ID 完全一致；金额、时间、状态、轨道和场景均使用对应 locale 格式。

```bash
bun run generate-paraglide
bun run generate-routes
```

- [ ] **步骤 6：验证并提交**

```bash
bunx vitest run tests/unit/payment-testing/pages.test.tsx tests/unit/admin-route-navigation.test.ts tests/unit/layouts/merchant-sidebar.test.ts
bunx biome check src/features/payment-testing/pages src/features/payment-testing/components src/routes/admin/test-center messages tests/unit/payment-testing/pages.test.tsx tests/e2e/payment-test-center.spec.ts
git add src/features/payment-testing/pages src/features/payment-testing/components src/routes/admin/test-center messages src/paraglide src/routeTree.gen.ts tests/unit/payment-testing/pages.test.tsx tests/e2e/payment-test-center.spec.ts
git commit -m "feat: add payment test center interface"
```

### 任务 9：加入保留策略、可观测性、运行时一致性与安全覆盖

**文件：**
- 修改：`src/server/operational-settings.ts`
- 修改：`src/features/operations/server/operational-retention.ts`
- 修改：`src/server/scheduled/maintenance.ts`
- 新建：`src/features/payment-testing/server/observability.ts`
- 测试：`tests/integration/payment-testing/retention.test.ts`
- 测试：`tests/integration/payment-testing/runtime-parity.test.ts`
- 测试：`tests/security/payment-testing/snapshot-redaction.test.ts`
- 测试：`tests/security/payment-testing/custom-callback-ssrf.test.ts`
- 修改：`tests/unit/server/node-runtime-adapters.test.ts`

- [ ] **步骤 1：写保留、脱敏、SSRF 和一致性失败测试**

断言测试证据保留最小/最大值、订单与生产记录保留、快照字节上限、递归 Secret/token 脱敏、DNS rebinding/私网拒绝、仅内置回调允许实例 origin、Queue 恢复以及 D1/SQLite 相同行为。

- [ ] **步骤 2：确认失败**

```bash
bunx vitest run tests/integration/payment-testing/retention.test.ts tests/integration/payment-testing/runtime-parity.test.ts tests/security/payment-testing/snapshot-redaction.test.ts tests/security/payment-testing/custom-callback-ssrf.test.ts
bun test tests/unit/server/node-runtime-adapters.test.ts
```

- [ ] **步骤 3：实现有界保留与指标**

扩展现有 operational settings parser，增加有界测试证据天数。按有界批次先删 receipt 再删 run，保留领域记录。复用现有 metrics，仅允许 protocol、environment、mode、scenario、result、error code 标签；禁止 merchant、URL、PID、address、order ID、token 标签。

- [ ] **步骤 4：验证 Workers/Bun 并简化触及差异**

运行一致性/安全测试，再用 `rg` 检查重复模式校验、脱敏分支、死的开发动作和未使用导出。只有确实减少调用方复杂度时才保留共享不变量/脱敏器，不扩大功能边界或格式化无关文件。

- [ ] **步骤 5：提交**

```bash
bunx vitest run tests/integration/payment-testing/retention.test.ts tests/integration/payment-testing/runtime-parity.test.ts tests/security/payment-testing/snapshot-redaction.test.ts tests/security/payment-testing/custom-callback-ssrf.test.ts
bun test tests/unit/server/node-runtime-adapters.test.ts
bunx biome check src/server/operational-settings.ts src/features/operations/server/operational-retention.ts src/server/scheduled/maintenance.ts src/features/payment-testing/server/observability.ts tests/integration/payment-testing tests/security/payment-testing tests/unit/server/node-runtime-adapters.test.ts
git add src/server/operational-settings.ts src/features/operations/server/operational-retention.ts src/server/scheduled/maintenance.ts src/features/payment-testing/server/observability.ts tests/integration/payment-testing tests/security/payment-testing tests/unit/server/node-runtime-adapters.test.ts
git commit -m "feat: harden payment test operations"
```

### 任务 10：文档、验证、推送、迁移与部署

**文件：**
- 新建：`docs/PAYMENT_TESTING.md`
- 新建：`docs/PAYMENT_TESTING.zh-CN.md`
- 修改：`README.md`
- 修改：`README.zh-CN.md`
- 修改：`tests/e2e/payment-test-center.spec.ts`

- [ ] **步骤 1：编写中英文成对文档**

说明沙盒模拟器、首批测试网配置、水龙头/地址前置条件、API 控制台、内置/自定义回调证据、生产真实资金确认、权限、保留与排错。明确 Ethereum Sepolia 需要运维配置 endpoint，TON/Aptos/Solana 本期仅支持模拟器。不得包含真实凭证或私钥操作。

- [ ] **步骤 2：在最终代码树只运行一次完整质量门**

```bash
bun run typecheck
bun run test
bun run check
bun run build
bun run build:bun
```

预期：五条命令全部退出 `0`。始终跳过的真实 provider 手工套件只记录为保留的手工资产，不声称自动通过。

- [ ] **步骤 3：在一次性本地 D1 与 SQLite 排练迁移**

对空数据库和代表性的 `0011` 前副本执行完整迁移链，验证行数、零孤儿/重复、轨道类型、沙盒初始化、查询计划与 `PRAGMA optimize`。分别启动 Workers 本地运行时和 Bun 输出，完成 GMPay/EPay 模拟运行并证明回调 receipt/pass 状态。

- [ ] **步骤 4：在两种主题和响应式尺寸执行浏览器验收**

启动本地服务，使用应用内浏览器完成引导测试、API 控制台、历史、详情、环境切换、取消生产确认、键盘导航、减少动画和内置回调。保存桌面/移动端的浅色与深色截图，确认文字和控件没有重叠。

- [ ] **步骤 5：提交交付文档与最终生成文件**

```bash
git add docs/PAYMENT_TESTING.md docs/PAYMENT_TESTING.zh-CN.md README.md README.zh-CN.md tests/e2e/payment-test-center.spec.ts
git commit -m "docs: document payment test workflows"
git status --short --branch
git log --oneline --decorate -12
```

预期：工作树干净，相对 `origin/main` 只领先本计划变更。

- [ ] **步骤 6：全部证据通过后推送部署**

```bash
bun run predeploy
git push origin main
bun run db:migrate:remote
bun run deploy
```

如果 push、质量门、本地迁移排练或 `predeploy` 任一失败，不得执行远程迁移/部署。记录 Git commit、Cloudflare deployment/version ID、迁移结果和线上资源 hash。

- [ ] **步骤 7：验证生产行为**

验证 `https://pay.gelooss.com/admin/test-center` 在认证并选择商户/环境后加载新 bundle。完成一条 GMPay 沙盒 exact-success 和一条 EPay callback-retry，核验历史/时间线证据及浅深色表现。对每个已配置测试网进行有界手工转账并保留交易证据。生产验收停在确认预览，除非用户另行授权真实资金金额与目标。

## 规格覆盖矩阵

| 已确认设计要求 | 实施任务 |
| --- | --- |
| 统一引导/API/历史测试中心 | 4、7、8 |
| GMPay + EPay 真实 handler | 4 |
| 沙盒模拟器进入真实支付状态机 | 2、5 |
| 生产一次性确认且禁止模拟 | 2、4、7 |
| 内置/自定义回调与重试 | 4、6 |
| 新商户自动沙盒初始化 | 1、3 |
| 首批测试网与商户自有地址 | 2、3、10 |
| 持久化时间线和通过/失败证据 | 1、6、8 |
| 商户/环境/RBAC 隔离 | 4、5、6、7、9 |
| 六语种、浅深色、响应式与无障碍 | 8、10 |
| Workers/Bun 一致性、保留和可观测性 | 9、10 |
| GitHub 推送与 Cloudflare 部署 | 10 |
