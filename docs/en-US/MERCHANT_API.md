# Merchant Integration API

[简体中文](../zh-CN/MERCHANT_API.md) · English

This guide is for shop, SaaS, and backend integrations. The production gateway is:

```text
https://pay.gelooss.com
```

Use **GMPay** for new integrations. It accepts JSON or form data and uses an
HMAC-SHA256 signature. Existing EPay applications can use the **EPay compatibility
API**, which preserves its fields and MD5 signature. Both protocols use the same
orders, checkout, payment confirmation, and notification delivery. Only the API
credential that created an order can query it.

## Before your first request

1. In the target merchant's **sandbox** or **production** environment, create an
   API credential and save its `pid` and one-time API Secret.
2. Grant `orders:create` to create payments and `orders:read` to query them.
3. Configure a ready receiving method in that merchant environment. Production
   orders can use only ready production receiving addresses.
4. Prepare a public HTTPS receiver for `notify_url`. Private, loopback, cloud
   metadata, credential-bearing, and unsafe-redirect targets are rejected.

Each `pid` belongs to exactly one merchant and environment. Do not send
`merchant_id`, `environment_id`, or an API Secret in a GMPay or EPay request.
Sandbox and production credentials, receiving addresses, and orders are isolated
from each other and cannot be mixed.

> Create orders, query orders, sign requests, and verify notifications only on
> your shop backend. The browser should receive only `payment_url` and open the
> checkout.

## Request signatures

GMPay and EPay build their signing source in the same way:

1. Exclude signing fields: `signature` for GMPay, `sign` and `sign_type` for EPay.
2. Exclude `null`, `undefined`, and empty strings; retain `0`.
3. Render numbers as ordinary decimal text and sort names in ASCII order.
4. Join fields as `key=value` with `&`; do not URL encode the signing source again.

GMPay calculates lowercase HMAC-SHA256 with the API Secret as its HMAC key. EPay
appends the API Secret to the normalized source and calculates lowercase MD5.
JSON encoding and URL encoding remain normal transport concerns; sign parsed
field values, not URL-encoded text.

This Node.js helper is suitable for GMPay requests and notifications:

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

Use decimal strings such as `"12.50"` for money. Do not sign or compare results
of floating-point accumulation.

## Create a GMPay order

```text
POST https://pay.gelooss.com/payments/gmpay/v1/order/create-transaction
Content-Type: application/json
```

| Field | Required | Description |
| --- | --- | --- |
| `pid` | Yes | API credential PID. |
| `order_id` | Yes | Your shop order ID, 1-128 characters and unique per credential. |
| `currency` | Yes | Three-character fiat code, for example `USD`. |
| `amount` | Yes | Positive decimal string with up to 8 decimal places. |
| `notify_url` | Yes | Immutable public HTTPS payment-notification URL. |
| `signature` | Yes | Lowercase HMAC-SHA256 over the other non-empty fields. |
| `token`, `network` | No | Supply both, for example `USDT` / `tron`, to choose a ready receiving method. |
| `redirect_url` | No | HTTPS page for payer completion, closure, or timeout. It does not prove payment. |
| `name` | No | Payer-facing order name, up to 500 characters. |
| `payment_type` | No | Compatibility field only. Use `token` and `network` to select payment. |

Omitting both `token` and `network` creates an order that waits for the payer to
select a receiving method, with `status: 4`. The gateway never chooses a chain or
asset implicitly.

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
  name: "Shop order",
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

// Persist these fields in your shop database, not just browser state.
await savePayment({
  orderId: body.order_id,
  tradeId: result.data.trade_id,
  paymentUrl: result.data.payment_url,
  requestId: result.request_id,
  expiresAt: result.data.expiration_time,
});
// Send result.data.payment_url to the payer's browser.
```

Successful responses have this shape:

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

`trade_id` is the gateway order ID; `payment_url` is the only URL the browser
should open; and `request_id` is the support correlation ID.

## Query a GMPay order

```text
GET https://pay.gelooss.com/payments/gmpay/v1/order/query
```

Provide `pid`, `signature`, and exactly one of `trade_id` or `order_id`. Sign all
non-empty query parameters, including `pid` and the chosen order selector, with
the GMPay rule.

```ts
const query = { pid: process.env.GMPAY_PID!, order_id: shopOrderId };
const url = new URL(`${gateway}/payments/gmpay/v1/order/query`);
for (const [key, value] of Object.entries({
  ...query,
  signature: signGmpay(query, process.env.GMPAY_API_SECRET!),
})) url.searchParams.set(key, value);
const result = await (await fetch(url)).json();
```

A create timeout is an unknown outcome. Do not create a replacement order ID;
query the original `order_id` first. If creation succeeded, the query returns its
order. Repeating the create returns `10002`.

## Status, redirects, and fulfilment

| `status` | `status_detail` | Meaning and shop action |
| --- | --- | --- |
| `4` | `pending` | Payer must select a receiving method; do not fulfil. |
| `1` | `pending`, `confirming`, `partially_paid` | Waiting for payment or chain confirmation; do not fulfil. |
| `2` | `paid`, `overpaid` | Payment completed; fulfil idempotently after a verified notification or signed query. |
| `3` | `expired`, `cancelled`, `failed`, `refunded` | Closed state; apply your inventory and after-sales policy. |

`redirect_url` improves payer experience only. It cannot replace a verified
gateway notification or signed order query as the fulfilment decision.

## GMPay Webhook notification and verification

The gateway sends a JSON `POST` to the order `notify_url`. These headers support
diagnostics and idempotency:

```text
x-gmpay-event-id
x-gmpay-delivery-id
x-gmpay-attempt
```

The payload contains `pid`, `trade_id`, `order_id`, `amount`, `actual_amount`,
`receive_address`, `token`, `block_transaction_id`, `status`, and `signature`.
Verify every non-empty field except `signature` with the same GMPay secret and
canonicalization. Return a non-200 response for invalid signatures, amounts, or
orders. Return HTTP `200` with plain-text `ok` only after the shop transaction
commits.

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
    // Enforce uniqueness on trade_id or x-gmpay-event-id; repeats never fulfil twice.
    if (await tx.paymentEventExists(payload.trade_id, payload.status)) return;
    await tx.recordPaymentEvent(payload);
    if (payload.status === 2) await tx.markOrderPaidOnce(payload.order_id);
  });
  return new Response("ok", { status: 200 });
}
```

Timeouts, non-`200` responses, non-`ok` acknowledgements, and network failures
are retried. An administrator can also resend a logical status, so notification
handling must remain idempotent.

## EPay compatibility API

EPay is for existing EPay integrations. New integrations should use GMPay.

| Purpose | Path and method |
| --- | --- |
| Create a standard compatible order | `GET` or form `POST /payments/epay/v1/order/create-transaction/submit.php` |
| Create a Pro-compatible order | `GET` or form `POST /payments/epay/v1/order/create-transaction/mapi.php` |
| Query an order | `GET /payments/epay/v1/order/create-transaction/api.php?act=order` |
| Payment notification | Signed GET query sent by the gateway to `notify_url` |

Create fields are `pid`, `money`, `out_trade_no`, `notify_url`, and `sign`, with
optional `return_url`, `name`, `type`, `param`, `clientip`, `device`, and
`sign_type=MD5`. EPay uses `money` and creates a `CNY` order. `type=USDT.tron`
chooses an asset and network; an empty `type` or `alipay` creates a selectable
compatibility order.

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

`submit.php` returns the same `status_code` / `data.payment_url` envelope as
GMPay. `mapi.php` returns `code`, `msg`, `trade_no`, `payurl`, `qrcode`, `img`,
and `param`. Queries require `act=order`, `pid`, and `sign`, plus exactly one of
`trade_no` or `out_trade_no`.

EPay notification is a GET query with `pid`, `trade_no`, `out_trade_no`, `type`,
`name`, `money`, `trade_status`, optional `param`, `sign`, and `sign_type=MD5`.
Sort all non-empty fields except `sign` and `sign_type`, append the Secret, and
calculate MD5. The acknowledgement must be HTTP `200` with plain-text `ok` or
`success`. Only `TRADE_SUCCESS` can fulfil an order; `WAIT_BUYER_PAY` is still
waiting, while `TRADE_CLOSED` and `TRADE_REFUNDED` cannot fulfil.

## Errors, rate limits, and recovery

GMPay and EPay `submit.php` responses include an HTTP status, a business code,
and `request_id` (also in the `x-request-id` response header). Provide only the
`request_id` when requesting support; never send the Secret or full signing
source.

| Code | Meaning | Shop action |
| --- | --- | --- |
| `10001` | Order not found | Check `pid`, environment, and selector. |
| `10002` | Shop order ID already exists | Query that `order_id`; do not create a replacement. |
| `10003` | Receiving method unavailable | Check the target environment's methods, address, and connection health. |
| `10004` | Invalid amount | Send a positive decimal string with at most 8 decimal places. |
| `10009` | Invalid parameters or oversized body | Check fields, signing source, and the 64 KiB request limit. |
| `10016` | Asset, network, or rate unavailable | Use a ready asset/network in the target environment. |
| `401` | PID, scope, or signature invalid | Check the credential environment and canonical source; never sign in the browser. |
| `429` | API credential rate limited | Back off and avoid concurrent replay of the same order. |
| `500` | Gateway internal error | Retain `request_id` and query the same order before retrying. |

## Shop Integration Handoff

- [ ] Complete create, checkout, simulated or testnet payment, notification,
  duplicate notification, and query in sandbox.
- [ ] Create production-specific credentials, receiving methods, and public HTTPS
  notification endpoint.
- [ ] Persist `order_id`, `trade_id`, `payment_url`, amount, currency, expiry, and
  `request_id` on the shop backend.
- [ ] Have the browser open only `payment_url`; do not expose a Secret, signing
  logic, or fulfilment decision to the client.
- [ ] Verify the notification and order/amount, then deduplicate, update the
  order, and fulfil in one transaction before replying `ok`.
- [ ] Query the same order after a timeout; do not fulfil until callback or query
  confirms payment.
- [ ] Complete one deliberately low-value, manually reviewed production payment
  before handling normal production volume.

Download the machine-readable [OpenAPI document](https://pay.gelooss.com/openapi.yaml). This guide and
that contract define all public merchant endpoints.
