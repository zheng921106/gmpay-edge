# 商户接入 API

简体中文 · [English](../en-US/MERCHANT_API.md)

本文件面向商城、SaaS 和业务后端的接入开发。生产网关固定为：

```text
https://pay.gelooss.com
```

建议新项目使用 **GMPay**。它使用 JSON 或表单请求与 HMAC-SHA256 签名。已有 EPay
程序可继续使用 **EPay 兼容接口**，其字段与 MD5 签名保持兼容。两套协议共用订单、收银台、
支付确认和通知投递；同一个订单只能通过创建它的 API 凭证读取。

## 接入前准备

1. 在目标商户的 **sandbox** 或 **production** 环境创建 API 凭证，保存 `pid` 与只展示一次的
   API Secret。
2. 为创建订单授予 `orders:create`，为查询订单授予 `orders:read`。
3. 在该商户和环境配置可用的收款方式。生产订单只能使用生产环境中已就绪的收款地址。
4. 为 `notify_url` 准备公网 HTTPS 接收端；内网、回环、云元数据地址、带 URL 凭证和不安全跳转
   目标都会被拒绝。

每个 `pid` 都绑定一个商户和一个环境。不要在 GMPay 或 EPay 请求中附加 `merchant_id`、
`environment_id` 或前端可见的 Secret。沙盒与生产凭证、收款地址和订单彼此隔离，不能混用。

> 所有创建订单、查询订单、签名和回调验签都必须在商城后端执行。浏览器只应收到
> `payment_url` 并跳转到收银台。

## 请求签名

GMPay 与 EPay 都按相同的规范化规则生成待签名字符串：

1. 排除签名字段；GMPay 排除 `signature`，EPay 排除 `sign` 与 `sign_type`。
2. 排除 `null`、`undefined` 和空字符串；保留 `0`。
3. 将数值写为普通十进制文本，字段名按 ASCII 升序排序。
4. 使用 `&` 拼接为 `key=value`，不要对待签名字符串再次 URL Encode。

GMPay 以 API Secret 为 HMAC Key 计算小写 HMAC-SHA256。EPay 在规范化字符串末尾追加
API Secret，再计算小写 MD5。HTTP 传输时可以正常 JSON 编码或 URL Encode；签名使用解析后的
字段值，而不是 URL 编码后的文本。

下面是可直接复用的 Node.js GMPay 签名函数：

```ts
import { createHmac } from "node:crypto";

export function signGmpay(
  values: Record<string, string | number | null | undefined>,
  secret: string,
) {
  const source = Object.entries(values)
    .filter(([key, value]) => key !== "signature" && value != null && value !== "")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHmac("sha256", secret).update(source, "utf8").digest("hex");
}
```

金额始终使用十进制字符串，例如 `"12.50"`；不要使用浮点数累加后的结果参与签名或金额比较。

## GMPay 创建订单

```text
POST https://pay.gelooss.com/payments/gmpay/v1/order/create-transaction
Content-Type: application/json
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `pid` | 是 | API 凭证 PID。 |
| `order_id` | 是 | 商城订单号，1-128 字符；同一凭证内唯一。 |
| `currency` | 是 | 三位法币代码，例如 `USD`。 |
| `amount` | 是 | 正数十进制字符串，最多 8 位小数。 |
| `notify_url` | 是 | 支付状态通知的公网 HTTPS 地址，创建后不可改。 |
| `signature` | 是 | 对其他非空字段计算的小写 HMAC-SHA256。 |
| `token`、`network` | 否 | 必须成对提供，例如 `USDT` / `tron`；指定可用收款方式。 |
| `redirect_url` | 否 | 付款人完成、关闭或超时时返回的 HTTPS 页面。它不表示支付成功。 |
| `name` | 否 | 面向付款人的订单名称，最多 500 字符。 |
| `payment_type` | 否 | 兼容字段；不要用它选择收款方式，应使用 `token` 与 `network`。 |

同时省略 `token` 与 `network` 会创建“待选择收款方式”的订单，响应 `status` 为 `4`；网关不会
默认选择任何链或资产。

```ts
import { signGmpay } from "./gmpay-sign.js";

const gateway = "https://pay.gelooss.com";
const body = {
  pid: process.env.GMPAY_PID!,
  order_id: `shop-${crypto.randomUUID()}`,
  currency: "USD",
  amount: "12.50",
  token: "USDT",
  network: "tron",
  name: "商城订单",
  notify_url: "https://shop.example.com/api/payments/gmpay/notify",
  redirect_url: "https://shop.example.com/orders/complete",
};
const signature = signGmpay(body, process.env.GMPAY_API_SECRET!);
const response = await fetch(
  `${gateway}/payments/gmpay/v1/order/create-transaction`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, signature }),
  },
);
const result = await response.json();
if (!response.ok || result.status_code !== 200) {
  throw new Error(`Gateway request failed: ${result.request_id}`);
}

// 在商城数据库持久化，而不是只放在浏览器状态中。
await savePayment({
  orderId: body.order_id,
  tradeId: result.data.trade_id,
  paymentUrl: result.data.payment_url,
  requestId: result.request_id,
  expiresAt: result.data.expiration_time,
});
// 将 result.data.payment_url 交给付款浏览器打开。
```

成功响应格式：

```json
{
  "status_code": 200,
  "message": "success",
  "data": {
    "trade_id": "26071406211234567890",
    "order_id": "shop-20260903-001",
    "amount": "12.50",
    "currency": "USD",
    "actual_amount": "12.50",
    "receive_address": "TExampleAddress",
    "token": "USDT",
    "network": "tron",
    "status": 1,
    "status_detail": "pending",
    "expiration_time": 1788451200,
    "payment_url": "https://pay.gelooss.com/checkout/26071406211234567890"
  },
  "request_id": "request-id"
}
```

`trade_id` 是网关订单号；`payment_url` 是唯一应由浏览器打开的地址；`request_id` 用于排查。

## GMPay 查询订单

```text
GET https://pay.gelooss.com/payments/gmpay/v1/order/query
```

查询参数需要 `pid`、`signature`，并且只能在 `trade_id` 和 `order_id` 中选择一个。将全部非空
查询参数（含 `pid` 和订单选择条件）按 GMPay 规则签名。

```ts
const query = { pid: process.env.GMPAY_PID!, order_id: shopOrderId };
const url = new URL(`${gateway}/payments/gmpay/v1/order/query`);
for (const [key, value] of Object.entries({
  ...query,
  signature: signGmpay(query, process.env.GMPAY_API_SECRET!),
})) url.searchParams.set(key, value);
const result = await (await fetch(url)).json();
```

创建请求超时是“结果未知”，不要换一个新订单号再次创建。先用同一 `order_id` 查询；若创建已成功，
查询会返回原订单，若再次创建则返回 `10002`。

## 状态、跳转与发货条件

| `status` | `status_detail` | 含义与商城动作 |
| --- | --- | --- |
| `4` | `pending` | 等待付款人选择收款方式；不可发货。 |
| `1` | `pending`、`confirming`、`partially_paid` | 等待付款或区块确认；不可发货。 |
| `2` | `paid`、`overpaid` | 已完成支付；通过验签回调或已签名查询确认后幂等发货。 |
| `3` | `expired`、`cancelled`、`failed`、`refunded` | 已关闭状态；按商城售后与库存规则处理。 |

`redirect_url` 仅用于改善付款人体验，不能代替网关回调或订单查询。商城必须以已验签的通知或
已签名的查询结果作为发货依据。

## GMPay 回调（Webhook）与验签

网关向订单的 `notify_url` 发起 JSON `POST`。请求带有以下便于排障和幂等的响应头：

```text
x-gmpay-event-id
x-gmpay-delivery-id
x-gmpay-attempt
```

回调正文包含 `pid`、`trade_id`、`order_id`、`amount`、`actual_amount`、`receive_address`、
`token`、`block_transaction_id`、`status` 与 `signature`。用同一个 API Secret 对回调中除
`signature` 外的非空字段按 GMPay 规则验签。验签失败、金额或订单不匹配时必须返回非 200；
仅在商城事务成功落库后返回 HTTP `200` 和纯文本 `ok`。

```ts
import { timingSafeEqual } from "node:crypto";
import { signGmpay } from "./gmpay-sign.js";

export async function handleGmpayNotification(request: Request) {
  const payload = await request.json();
  const expected = signGmpay(payload, process.env.GMPAY_API_SECRET!);
  const received = String(payload.signature ?? "");
  const valid = received.length === expected.length && timingSafeEqual(
    Buffer.from(received, "utf8"), Buffer.from(expected, "utf8"),
  );
  if (!valid) return new Response("invalid signature", { status: 401 });

  await database.transaction(async (tx) => {
    // 以 trade_id 或 x-gmpay-event-id 建唯一约束，重复投递不得重复发货。
    if (await tx.paymentEventExists(payload.trade_id, payload.status)) return;
    await tx.recordPaymentEvent(payload);
    if (payload.status === 2) await tx.markOrderPaidOnce(payload.order_id);
  });
  return new Response("ok", { status: 200 });
}
```

网关会对超时、非 `200`、非 `ok` 的确认和网络失败重试。管理员手动重发也会产生同一逻辑状态的
新投递，因此回调处理必须是幂等的。

## EPay 兼容接口

EPay 适用于已有 EPay 集成的商城。新项目优先使用 GMPay。

| 用途 | 地址与方式 |
| --- | --- |
| 创建普通兼容订单 | `GET` 或表单 `POST /payments/epay/v1/order/create-transaction/submit.php` |
| 创建 Pro 兼容订单 | `GET` 或表单 `POST /payments/epay/v1/order/create-transaction/mapi.php` |
| 查询订单 | `GET /payments/epay/v1/order/create-transaction/api.php?act=order` |
| 支付通知 | 网关向 `notify_url` 发起签名 GET Query |

EPay 创建字段为 `pid`、`money`、`out_trade_no`、`notify_url`、`sign`；可选 `return_url`、
`name`、`type`、`param`、`clientip`、`device` 与 `sign_type=MD5`。EPay 金额以 `money` 表示，
订单货币固定为 `CNY`。`type=USDT.tron` 选择资产和网络；空 `type` 或 `alipay` 会创建待选择
收款方式的兼容订单。

```php
<?php
function epaySign(array $params, string $secret): string {
    unset($params['sign'], $params['sign_type']);
    $params = array_filter($params, fn($value) => $value !== null && $value !== '');
    ksort($params, SORT_STRING);
    $pairs = [];
    foreach ($params as $key => $value) $pairs[] = $key . '=' . (string) $value;
    return md5(implode('&', $pairs) . $secret);
}

$params = [
    'pid' => getenv('EPAY_PID'),
    'money' => '88.00',
    'out_trade_no' => 'shop-20260903-001',
    'notify_url' => 'https://shop.example.com/api/payments/epay/notify',
    'return_url' => 'https://shop.example.com/orders/complete',
    'type' => 'USDT.tron',
    'sign_type' => 'MD5',
];
$params['sign'] = epaySign($params, getenv('EPAY_API_SECRET'));
$response = file_get_contents(
    'https://pay.gelooss.com/payments/epay/v1/order/create-transaction/submit.php?'
    . http_build_query($params),
);
```

`submit.php` 返回和 GMPay 相同的 `status_code` / `data.payment_url` Envelope；`mapi.php` 返回
兼容字段 `code`、`msg`、`trade_no`、`payurl`、`qrcode`、`img`、`param`。查询需要 `act=order`、
`pid`、`sign`，并在 `trade_no` 与 `out_trade_no` 中二选一。

EPay 通知为 GET Query，包含 `pid`、`trade_no`、`out_trade_no`、`type`、`name`、`money`、
`trade_status`、可选 `param`、`sign` 与 `sign_type=MD5`。对除 `sign` 和 `sign_type` 外的非空字段
排序，追加 Secret 后计算 MD5。返回 HTTP `200` 的纯文本 `ok` 或 `success` 才算确认成功。
`TRADE_SUCCESS` 是可发货状态；`WAIT_BUYER_PAY` 仍在等待；`TRADE_CLOSED` 与 `TRADE_REFUNDED`
不能发货。

## 错误、限流与故障恢复

所有 GMPay 及 EPay `submit.php` 响应都有 HTTP 状态、业务代码和 `request_id`（HTTP 响应头为
`x-request-id`）。排障时提供 `request_id`，不要上传 Secret 或完整签名原文。

| 业务代码 | 含义 | 商城处理 |
| --- | --- | --- |
| `10001` | 订单不存在 | 检查 `pid`、环境和查询条件。 |
| `10002` | 商城订单号已存在 | 查询该 `order_id`，不可创建替代订单。 |
| `10003` | 收款方式不可用 | 检查目标环境中的收款方式、地址和连接健康。 |
| `10004` | 金额无效 | 使用正数十进制字符串，最多 8 位小数。 |
| `10009` | 参数无效或请求体过大 | 对照字段、签名来源和 64 KiB 请求上限。 |
| `10016` | 资产、网络或汇率不可用 | 使用该环境已启用且就绪的资产/网络。 |
| `401` | PID、Scope 或签名无效 | 检查凭证环境和规范化字符串；不要在前端签名。 |
| `429` | API 凭证被限流 | 按响应退避重试，避免并发重放同一订单。 |
| `500` | 网关内部错误 | 保留 `request_id`，对同一订单号查询后再决定重试。 |

## 商城接入交付清单

- [ ] 沙盒完成创建、收银台、模拟或测试网付款、回调、重复回调和查询闭环。
- [ ] 生产环境单独创建 API 凭证、收款方式和公网 HTTPS 回调地址。
- [ ] 商城后端保存 `order_id`、`trade_id`、`payment_url`、金额、币种、有效期和 `request_id`。
- [ ] 付款前端只跳转 `payment_url`；不把 Secret、签名逻辑或发货判断放到浏览器。
- [ ] 回调先验签并检查订单和金额，再在一个事务中去重、更新订单和发货，最后返回 `ok`。
- [ ] 超时先查询同一订单；回调和查询均未确认前不发货。
- [ ] 生产支付使用真实资产，先以低金额完成一笔人工核对的完整闭环。

机器可读合同可从 [OpenAPI 文档](https://pay.gelooss.com/openapi.yaml) 下载；所有公开接口都以该合同和本页为准。
