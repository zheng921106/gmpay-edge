# Merchant Payment Notifications

[简体中文](../zh-CN/WEBHOOKS.md) · English

This document defines the contract for a shop receiving order-status
notifications. Merchant notifications are distinct from provider and Telegram
inbound endpoints: the `notify_url` at order creation exclusively determines
the destination, and only events for that order's API credential are delivered.

## URL and security boundary

- `notify_url` must be a public HTTPS URL and cannot change after order creation.
- Each order has one notification target. There is no global merchant callback
  and events are never broadcast to another order URL.
- Keep the Secret on the shop backend. Do not put it in browser code, URLs, logs,
  support tickets, or plaintext database fields.
- The receiver should enforce HTTPS, bound request bodies, record request/event
  IDs, and reject invalid signatures.

Sandbox and production use identical notification paths and payloads, but
verification must use the Secret from the environment that created the order.

## GMPay JSON notification

GMPay sends JSON `POST` to `notify_url` with:

```text
content-type: application/json
x-gmpay-event-id: <stable event id>
x-gmpay-delivery-id: <delivery id>
x-gmpay-attempt: <attempt number>
```

The body contains:

| Field | Meaning |
| --- | --- |
| `pid` | API credential PID that created the order. |
| `trade_id`, `order_id` | Gateway order ID and shop order ID. |
| `amount`, `actual_amount` | Requested and paid amounts as decimal strings. |
| `receive_address`, `token` | Payment target and asset. |
| `block_transaction_id` | Chain or provider transaction identifier. |
| `status` | `1` waiting, `2` completed, `3` closed. |
| `signature` | Lowercase HMAC-SHA256. |

Exclude `signature` and empty values, sort field names in ASCII order, join as
`key=value` with `&`, and calculate lowercase HMAC-SHA256 using the API Secret
as the HMAC key. Compare signatures in constant time.

## EPay GET notification

EPay sends `GET` query parameters to `notify_url`: `pid`, `trade_no`,
`out_trade_no`, `type`, `name`, `money`, `trade_status`, optional `param`,
`sign`, and `sign_type=MD5`.

Exclude `sign`, `sign_type`, and empty values, sort in ASCII order, join the
fields, append the API Secret, and calculate lowercase MD5. `TRADE_SUCCESS`
means payment completed; `WAIT_BUYER_PAY` is still waiting; `TRADE_CLOSED` and
`TRADE_REFUNDED` must not fulfil an order.

## Required processing sequence

1. Parse the request and verify its GMPay HMAC or EPay MD5. Reject an invalid
   signature immediately.
2. Find the internal shop order by `trade_id`/`trade_no` and `order_id`/
   `out_trade_no`, then verify PID, amount, and currency.
3. In one database transaction, persist a unique event key, update payment state,
   and fulfil exactly once for a completed payment.
4. After the transaction commits, return HTTP `200` with plain-text `ok`.
   EPay also accepts `success`.

Enforce uniqueness with `x-gmpay-event-id`, `trade_id + status`, or an internal
payment-event table. Never assume a callback arrives only once: retries, network
timeouts, manual resends, and subsequent order queries can expose the same
payment state again.

## Acknowledgement and retries

Network failures, timeouts, non-`200` responses, bodies other than exact `ok`,
and, for EPay, bodies other than `success`, are unacknowledged. The gateway
persists delivery history and retries with bounded backoff. Manual resend keeps
the history and creates a new delivery attempt.

The receiver should complete quickly. Move slow shop work to an internal queue,
but persist the event and its one-time-fulfilment guarantee before replying
`ok`. When the receiver is temporarily unavailable, return `500` so the gateway
retries; do not reply `ok` and expect a later redelivery.

## Production acceptance

1. Create a sandbox order and inspect every signed JSON or query field.
2. Test a successful callback, tampered amount, tampered signature, duplicate
   event, timeout, and `500` response.
3. Prove that repeated `TRADE_SUCCESS` or `status=2` cannot duplicate inventory,
   fulfilment, or accounting work.
4. Use a low-value production order to validate signature, confirmation, shop
   accounting, and closure/refund handling.
5. Investigate incidents with `request_id`, `trade_id`, and `x-gmpay-event-id`;
   never expose the API Secret.
