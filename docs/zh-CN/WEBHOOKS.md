# 商户支付回调

简体中文 · [English](../en-US/WEBHOOKS.md)

本文说明商城接收订单状态通知的合同。商户回调与供应商、Telegram 等系统入站端点不同：
商户回调由订单创建时的 `notify_url` 唯一决定，并且只投递该订单所属 API 凭证的事件。

## 地址与安全边界

- `notify_url` 必须为公网 HTTPS 地址，在创建订单后不可修改。
- 每个订单只保留一个回调目标；不存在全局商户回调，也不会广播到其他订单地址。
- Secret 只保留在商城后端。不要在前端、URL、日志、客服工单或数据库明文字段中保存它。
- 回调接收端应限制为 HTTPS、限制请求体大小、记录 `request_id`/事件 ID，并拒绝不合法签名。

沙盒和生产回调使用完全相同的路径和格式，但必须使用订单创建凭证所属环境的 Secret 验签。

## GMPay JSON 回调

GMPay 向 `notify_url` 发起 JSON `POST`，并携带：

```text
content-type: application/json
x-gmpay-event-id: <stable event id>
x-gmpay-delivery-id: <delivery id>
x-gmpay-attempt: <attempt number>
```

正文包含以下字段：

| 字段 | 说明 |
| --- | --- |
| `pid` | 创建订单的 API 凭证 PID。 |
| `trade_id`、`order_id` | 网关订单号与商城订单号。 |
| `amount`、`actual_amount` | 订单金额和实际支付金额，均为十进制字符串。 |
| `receive_address`、`token` | 收款目标和资产。 |
| `block_transaction_id` | 区块或提供商交易标识。 |
| `status` | `1` 等待、`2` 完成、`3` 已关闭。 |
| `signature` | 小写 HMAC-SHA256。 |

签名规则：排除 `signature` 和空值，按 ASCII 排序，以 `&` 拼接 `key=value`，使用 API Secret
作为 HMAC Key 计算小写 HMAC-SHA256。签名比较必须使用常量时间比较。

## EPay GET 回调

EPay 向 `notify_url` 发起带 Query 参数的 `GET`。字段为 `pid`、`trade_no`、`out_trade_no`、
`type`、`name`、`money`、`trade_status`、可选 `param`、`sign` 和 `sign_type=MD5`。

排除 `sign` 和 `sign_type` 以及空值，按 ASCII 排序拼接后追加 API Secret，计算小写 MD5。
`TRADE_SUCCESS` 表示支付完成；`WAIT_BUYER_PAY` 仍在等待；`TRADE_CLOSED` 与
`TRADE_REFUNDED` 均不可发货。

## 正确的处理顺序

1. 解析请求并验证 GMPay HMAC 或 EPay MD5；无效签名立即失败。
2. 根据 `trade_id`/`trade_no`、`order_id`/`out_trade_no` 查询商城内部订单，确认 PID、金额和币种。
3. 在同一个数据库事务中保存事件唯一键、更新支付状态并仅在完成状态执行一次发货。
4. 事务提交后返回 HTTP `200` 的纯文本 `ok`；EPay 也接受 `success`。

以 `x-gmpay-event-id`、`trade_id + status` 或商城内部支付事件表建立唯一约束。不要以“回调只会来
一次”作为假设：自动重试、网络超时、人工重发和页面刷新后的查询均会导致重复观察到同一支付状态。

## 确认与重试

下列任一情况都会被视为未确认：网络连接失败、超时、非 HTTP `200`、正文不是精确的 `ok`，以及
EPay 中不是 `success` 的其他正文。网关保存投递记录并使用有界退避重试。管理员重发会保留历史，
并创建新的投递尝试。

回调必须尽快完成，慢任务应在商城内部队列异步处理，但“事件已持久化且不会重复发货”必须在回复
`ok` 前完成。若接收端暂时不可用，可返回 `500` 让网关重试；不要返回 `ok` 后再希望网关补发。

## 生产验收

1. 在沙盒创建订单，核对 JSON 或 Query 中的每个签名字段。
2. 分别测试成功回调、篡改金额、篡改签名、重复事件、超时与 `500`。
3. 证明重复 `TRADE_SUCCESS` 或 `status=2` 不会重复扣库存、发货或记账。
4. 以低金额生产订单验证签名、确认、商城入账和退款/关闭处理。
5. 发生异常时，以 `request_id`、`trade_id` 和 `x-gmpay-event-id` 排查，不泄露 API Secret。
