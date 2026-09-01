# Merchant API Documentation Design

## Goal

Give an external ecommerce application a complete, copyable integration path for
both GMPay and EPay, and expose that guide beside the machine-readable OpenAPI
reference at `/docs`.

## Scope

- Document sandbox and production environments, API credentials, tenant scope,
  supported payment selection, request signing, order creation, order queries,
  checkout redirects, callbacks, retries, idempotency, statuses, and errors.
- Provide working `curl`, Node.js/TypeScript, and PHP examples for GMPay
  HMAC-SHA256 and EPay MD5 requests plus callback verification.
- Keep GMPay as the primary protocol and describe EPay as a compatibility
  boundary over the same order and webhook state machine.
- Update `public/openapi.yaml` so its title, tenancy model, server guidance,
  request fields, response envelopes, callbacks, and error responses match the
  implemented routes.
- Render a responsive guide in the existing `/docs` route with a clear link to
  the Scalar OpenAPI reference. Do not add a second router or documentation
  runtime.

## Non-goals

- No SDK package, generated client, or new merchant API endpoint.
- No changes to payment authentication, signing, order state transitions, or
  callback delivery behavior.
- No real payment or provider smoke test from the documentation UI.

## Design

### Documentation sources

The paired Markdown guides remain the canonical human-readable content:

- `docs/zh-CN/MERCHANT_API.md` for Simplified Chinese;
- `docs/en-US/MERCHANT_API.md` for English.

The public page imports the selected guide as build-time text and renders it
with the existing `react-markdown` dependency. The page keeps the existing
Scalar reference backed by `/openapi.yaml`; both views therefore ship from the
same deployment and no runtime filesystem access is needed.

### Website information architecture

`/docs` opens on an integration guide with these sections:

1. Quick start and environment/base URL;
2. Credential and merchant/environment scope;
3. GMPay JSON create/query and HMAC signing;
4. EPay form/query create and MD5 signing;
5. Checkout hand-off and payment selection;
6. GMPay POST and EPay GET callbacks, signature verification, acknowledgement,
   duplicate delivery, and retry handling;
7. Status mapping, error codes, idempotency, timeout recovery, and security
   checklist;
8. Links to the interactive OpenAPI reference and local payment test center.

The guide uses a stable in-page section navigation, code blocks with copyable
text, and responsive layout. The OpenAPI view remains available as a sibling
tab/link and keeps Scalar's existing theme integration.

### Protocol contract

The guide and OpenAPI must describe the exact current contracts:

- GMPay create: `POST /payments/gmpay/v1/order/create-transaction`, JSON or
  URL-encoded body, `pid`, `order_id`, `currency`, `amount`, `notify_url`,
  `signature`, and optional `token` + `network`, `redirect_url`, `name`, and
  `payment_type`.
- GMPay query: `GET /payments/gmpay/v1/order/query`, exactly one of `trade_id`
  or `order_id`, signed with `signature`.
- EPay create: GET or form POST
  `/payments/epay/v1/order/create-transaction/submit.php`; `mapi.php` returns
  the legacy EPay shape. Document `pid`, `money`, `out_trade_no`, `notify_url`,
  optional redirect/name/type/param/device fields, `sign`, and `sign_type`.
- EPay query: `GET /payments/epay/v1/order/create-transaction/api.php?act=order`
  with exactly one of `trade_no` or `out_trade_no`.
- GMPay signatures are lowercase HMAC-SHA256 over sorted, non-empty fields,
  excluding `signature`; EPay signatures are lowercase MD5 over the same
  canonical string plus the Secret, excluding `sign` and `sign_type`.
- Create/query responses expose `status_code`, `message`, `data`, and
  `request_id`; EPay MAPI and query retain their legacy `code`/`msg` fields.
- Callback payloads, status values, acknowledgement text, retry behavior, and
  duplicate-event handling match `src/features/webhooks/server/delivery.ts`
  and the protocol adapters.

### Localization and accessibility

The guide has Chinese and English source files with a visible language link.
The page follows the existing locale/theme context, keyboard navigation, focus
styles, reduced-motion behavior, and responsive layout. UI labels introduced by
the page use Paraglide messages; protocol field names, endpoint paths, and code
remain unchanged.

### Verification

- Unit tests assert that the OpenAPI document includes every public merchant
  route, required request/response fields, callback definitions, and current
  multi-merchant wording.
- Tests assert the guide contains both protocol paths, signing rules, callback
  acknowledgement, idempotency, status/error tables, and all three examples.
- Run focused tests, `bun run typecheck`, `bun run check`, `bun run build`, and
  `bun run build:bun`.
- Use the authenticated browser session to verify `/docs` renders the guide,
  OpenAPI reference link, both themes, mobile layout, and code blocks without
  console errors.
