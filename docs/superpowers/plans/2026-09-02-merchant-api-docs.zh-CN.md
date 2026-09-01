# 商户 API 文档实施计划

> **供代理执行：** 必须按任务逐项执行，步骤使用复选框（`- [ ]`）跟踪。

**目标：** 在 `/docs` 网站中发布 GMPay 和 EPay 的完整接入指南，并保留交互式 OpenAPI 参考。

**架构：** 成对的商户 Markdown 指南作为人工阅读来源，使用现有 `react-markdown` 在构建时渲染；`public/openapi.yaml` 作为机器可读契约；扩展现有文档客户端页面，不新增路由或运行时文档服务。

**技术栈：** React 19、TanStack Start、Scalar API Reference、react-markdown、Paraglide、OpenAPI 3.1、Vitest、Biome、Bun、Wrangler。

**设计文档：** `docs/superpowers/specs/2026-09-02-merchant-api-docs-design.zh-CN.md`

## 全局约束

- GMPay 仍是主协议；EPay 仍是共享订单和 Webhook 流程之上的兼容适配器。
- API 凭证按商户和环境隔离；文档不得包含真实 Secret。
- 公开路径、签名规则、状态值、错误码、回调确认文本和重试行为必须与现有处理器一致。
- 文档壳新增的用户界面标签使用 Paraglide；协议字段和代码示例保持字面值。
- 保留现有 Scalar 主题、响应式布局和仅客户端加载边界。
- 发布前执行聚焦测试、`bun run typecheck`、`bun run check`、`bun run build`、`bun run build:bun` 和浏览器验证。

---

### 任务 1：扩展人工阅读的商户指南

**文件：**
- 修改：`docs/zh-CN/MERCHANT_API.md`
- 修改：`docs/en-US/MERCHANT_API.md`

**步骤：**

- [ ] 添加 Base URL、沙盒/生产凭证、范围隔离和五步快速开始。
- [ ] 完整说明 GMPay JSON/表单创建、查询、字段约束、响应和状态。
- [ ] 完整说明 EPay submit、MAPI、查询、类型选择、MD5 签名和旧版状态。
- [ ] 添加 GMPay HMAC-SHA256、EPay MD5、回调验签的 `curl`、Node.js/TypeScript、PHP 示例。
- [ ] 添加回调确认、重复投递、重试、幂等、错误、安全和上线检查表。
- [ ] 使用 Biome 格式化并检查标题、链接、代码块和占位符。

### 任务 2：对齐 OpenAPI 契约

**文件：**
- 修改：`public/openapi.yaml`
- 创建：`tests/unit/docs/merchant-api-contract.test.ts`

**步骤：**

- [ ] 修正 API 标识、服务器占位地址和多商户/环境描述。
- [ ] 补充 GMPay、EPay 每个端点的字段、内容类型、签名排除项和回调说明。
- [ ] 对齐响应、状态枚举、EPay `code`/`msg`、`request_id` 和错误示例。
- [ ] 添加不依赖网络的 YAML 契约回归测试。

### 任务 3：在 `/docs` 渲染指南

**文件：**
- 创建：`src/features/docs/merchant-guide.tsx`
- 修改：`src/features/docs/api-reference-client.tsx`
- 修改：六个 `messages/*.json` 文件
- 创建：`tests/unit/docs/merchant-guide-content.test.ts`

**步骤：**

- [ ] 添加指南内容测试，断言两套协议路径、签名、回调、幂等、状态/错误和三种示例。
- [ ] 构建时导入中英文 Markdown，简体中文使用中文指南，其他语言安全回退英文。
- [ ] 在同一 `/docs` 页面加入接入指南与交互式 OpenAPI 参考导航，保持主题、移动和无障碍行为。
- [ ] 运行 Paraglide 编译、聚焦测试、类型检查和 Biome 检查。

### 任务 4：验证、提交和发布

**步骤：**

- [ ] 执行完整测试、Cloudflare/Bun 构建，并记录与本次变更无关的网络测试限制。
- [ ] 浏览器检查 `/docs` 的标题、代码块、OpenAPI 链接、明暗主题、移动视图和控制台日志，不执行支付。
- [ ] 执行 `bun run predeploy`，检查 diff 后提交 `docs: publish merchant api integration guide`。
- [ ] 推送 `main`、执行 `bun run deploy`，验证 Wrangler 版本、`https://pay.gelooss.com/status`，并汇报证据。
