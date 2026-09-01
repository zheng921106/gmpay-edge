# Payment Test Center

[简体中文](PAYMENT_TESTING.zh-CN.md) · English

The authenticated payment test center at `/admin/test-center` exercises the
same GMPay and EPay protocol handlers, order service, payment state machine,
Webhook outbox, and callback verification used by merchant traffic. It does not
maintain a separate development-only order path.

## Access and environments

Merchant members need `merchant` read permission to view resources and runs,
create permission to preflight or start a run, and update permission to advance
a simulator scenario, request a network refresh, retry a callback, or cancel a
run. The active merchant and environment are always resolved from the server
session.

Sandbox and production resources are isolated:

- Sandbox permits the built-in simulator and explicitly configured testnets.
- Production permits mainnet receiving methods only and never exposes simulator
  controls.
- Switching merchant or environment reloads API keys, receiving methods, and
  history for the new scope.

Every new merchant receives one enabled sandbox test API key and a simulator
receiving method. The one-time API secret remains server-side when the test
center signs a request and is never returned in snapshots.

## Simulator workflow

1. Open `/admin/test-center` and select the sandbox environment.
2. Choose GMPay or EPay, the simulator mode, a scenario, an API key, and the
   simulator receiving method.
3. Use **Check readiness**, then start the test.
4. Run each displayed simulator step. Observations enter through the normal
   payment ingestion service; the simulator does not write order status.
5. Open **View evidence** to inspect the redacted request, response, payment,
   Webhook, callback receipt, audit events, and final result.

The built-in callback receiver is the default and closes the loop within the
instance. A custom callback must be a public HTTPS endpoint. Hostnames are
resolved again before delivery, and private, local, reserved, credentialed, or
DNS-rebound destinations are rejected.

Available scenarios cover exact, partial, over, late, failed, duplicate,
confirmation-progressing, reorganization-recovery, and callback-retry behavior.

## Testnet workflow

The first release supports native assets on these sandbox rails:

| Rail | Native asset | Operator requirement |
| --- | --- | --- |
| TRON Nile | TRX | Healthy Nile RPC and merchant-owned public address |
| Ethereum Sepolia | ETH | Operator-configured healthy endpoint and merchant-owned public address |
| Base Sepolia | ETH | Healthy RPC and merchant-owned public address |
| BSC Testnet | BNB | Healthy RPC and merchant-owned public address |
| Polygon Amoy | POL | Healthy RPC and merchant-owned public address |

Ethereum Sepolia intentionally has no default public endpoint. Configure a
provider or your own node before enabling its receiving method. Obtain test
assets from the network's current official faucet and configure only a public
receiving address. Never enter a private key, seed phrase, or withdrawal
credential. TON, Aptos, and Solana are simulator-only in this release.

Start a testnet run from the guided page, send the exact asset amount to the
displayed checkout address, then use **Check payment**. Network observations use
the normal read-only adapter and confirmation policy.

## API console and history

`/admin/test-center/console` provides GMPay/EPay protocol switching and shows
the selected endpoint, structured input, redacted signed request, response,
request ID, status, and duration. Additional raw parameters cannot override the
selected PID, amount, asset, network, callback, or signature fields.

`/admin/test-center/runs` provides scoped, cursor-based history. A run detail
page composes chronological evidence from the test run, order, payment,
Webhook, callback receipt, and audit records. Stored snapshots are recursively
redacted and limited to 64 KiB.

## Production confirmation

Production is a real-funds workflow. Starting a production test first creates a
short-lived, one-time confirmation that lists the amount, currency, asset,
network, and callback destination. Cancelling the dialog creates no order.
Confirming consumes the token and creates a normal production order; the test
center never sends funds on the merchant's behalf. Production acceptance must
stop at the preview unless an operator separately authorizes the exact amount
and destination.

## Retention and operations

The `retention.payment_test_evidence_days` operational setting accepts 7 to 365
days and defaults to 90. Scheduled cleanup deletes callback receipts before
terminal test runs. It never deletes referenced orders, payments, Webhook
events, deliveries, attempts, or audit records.

Privacy-safe operation metrics cover preflight, protocol request, order create,
payment detection, confirmation, and callback delivery. Labels are limited to
protocol, environment, mode, scenario, result, and structured error code.

## Troubleshooting

- **No compatible receiving method:** enable a receiving method whose rail
  class matches simulator, testnet, or production mode and bind the asset.
- **Credential unavailable:** choose an enabled, unexpired key with
  `orders:create` scope in the active environment.
- **Method not ready:** verify the public endpoint, reported chain ID, health,
  address, and asset binding.
- **Callback unsafe:** use public HTTPS and remove credentials, redirects to
  private hosts, or DNS records that return private/reserved addresses.
- **Run remains active:** inspect the evidence timeline, request a payment
  refresh for a real network, or retry only a failed/dead callback delivery.

