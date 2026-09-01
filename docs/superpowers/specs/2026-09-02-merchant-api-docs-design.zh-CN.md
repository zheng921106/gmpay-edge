# 商户 API 文档设计

## 目标

为外部商城提供 GMPay 和 EPay 两套协议的完整、可复制接入路径，并在
`/docs` 网站页面中同时展示接入指南和机器可读的 OpenAPI 参考。

## 范围

- 说明沙盒与生产环境、API 凭证、商户范围、支付方式选择、请求签名、创建订单、
  查询订单、收银台跳转、回调、重试、幂等、状态和错误。
- 提供 GMPay HMAC-SHA256、EPay MD5 的 `curl`、Node.js/TypeScript、PHP 示例，
  以及回调验签示例。
- GMPay 作为主协议，EPay 作为共享订单和 Webhook 状态机之上的兼容边界。
- 更新 `public/openapi.yaml`，使标题、多商户模型、服务器说明、请求字段、响应封装、
  回调和错误响应与实际路由一致。
- 在现有 `/docs` 路由中渲染响应式接入指南，并链接到 Scalar OpenAPI 参考，不新增路由
  或文档运行时。

## 不包含

- 不新增 SDK、生成客户端或新的商户 API 端点。
- 不修改支付鉴权、签名、订单状态流转或回调投递行为。
- 文档页面不发起真实支付或 Provider 烟雾测试。

## 设计

### 文档来源

成对的 Markdown 指南作为人工阅读的规范来源：

- `docs/zh-CN/MERCHANT_API.md`：简体中文；
- `docs/en-US/MERCHANT_API.md`：英文。

网站页面在构建时导入当前语言的指南文本，使用现有 `react-markdown` 依赖渲染。
Scalar 继续从 `/openapi.yaml` 加载参考文档。两者都随同一部署发布，不在运行时读取文件系统。

### 网站信息架构

`/docs` 默认打开接入指南，包含：

1. 快速开始、环境和 Base URL；
2. 凭证与商户/环境范围；
3. GMPay JSON 创建/查询和 HMAC 签名；
4. EPay 表单/查询创建和 MD5 签名；
5. 收银台跳转和支付方式选择；
6. GMPay POST 与 EPay GET 回调、验签、确认、重复投递和重试；
7. 状态映射、错误码、幂等、超时恢复和安全检查清单；
8. 交互式 OpenAPI 参考及本地支付测试中心链接。

指南使用稳定的页内导航、可复制代码块和响应式布局。OpenAPI 作为同级视图或链接保留，
继续使用 Scalar 现有的主题集成。

### 协议契约

指南和 OpenAPI 必须准确描述当前实现：

- GMPay 创建：`POST /payments/gmpay/v1/order/create-transaction`，支持 JSON 或表单，
  必填 `pid`、`order_id`、`currency`、`amount`、`notify_url`、`signature`，可选成对的
  `token` + `network`、`redirect_url`、`name`、`payment_type`。
- GMPay 查询：`GET /payments/gmpay/v1/order/query`，`trade_id` 与 `order_id` 必须二选一，
  使用 `signature` 签名。
- EPay 创建：GET 或表单 POST
  `/payments/epay/v1/order/create-transaction/submit.php`；`mapi.php` 返回旧版 EPay 结构。
  说明 `pid`、`money`、`out_trade_no`、`notify_url`、跳转/名称/类型/param/device 等可选字段、
  `sign` 和 `sign_type`。
- EPay 查询：`GET /payments/epay/v1/order/create-transaction/api.php?act=order`，
  `trade_no` 与 `out_trade_no` 必须二选一。
- GMPay 签名是排除 `signature` 后对非空字段排序并计算小写 HMAC-SHA256；EPay 签名是排除
  `sign`、`sign_type` 后对同样的规范字符串拼接 Secret 并计算小写 MD5。
- 创建/查询响应包含 `status_code`、`message`、`data`、`request_id`；EPay MAPI 和查询保留旧版
  `code`/`msg` 字段。
- 回调载荷、状态值、确认文本、重试行为和重复事件处理必须与
  `src/features/webhooks/server/delivery.ts` 及协议适配器一致。

### 本地化和无障碍

指南提供中文和英文源文件，并提供可见语言链接。页面沿用现有语言/主题上下文、键盘导航、
焦点样式、减少动画和响应式布局。新增页面 UI 标签使用 Paraglide；协议字段、端点和代码保持原样。

### 验证

- 单元测试断言 OpenAPI 包含所有公开商户路由、必填请求/响应字段、回调定义和当前多商户说明。
- 测试断言指南同时包含两套协议路径、签名规则、回调确认、幂等、状态/错误表和三种示例。
- 执行聚焦测试、`bun run typecheck`、`bun run check`、`bun run build`、`bun run build:bun`。
- 使用已登录浏览器检查 `/docs` 指南、OpenAPI 链接、明暗主题、移动布局和代码块，并确认无控制台错误。
