# GMPay Edge Multi-Merchant Design

**Status:** Approved for implementation planning
**Date:** 2026-09-01

## Goal

Evolve GMPay Edge from a single-merchant deployment into a multi-merchant
gateway while preserving the existing GMPay/EPay protocol, current production
orders, Cloudflare Workers/Bun parity, and the existing platform RBAC system.

The product supports both platform-created merchants and self-registration.
Registration is automatic: every new merchant receives enabled sandbox and
production environments immediately. A user may belong to multiple merchants
and may hold different merchant roles in each one.

## Decisions

- Use one shared D1/SQLite database with mandatory row-level tenant scope.
- Add a merchant and environment scope to merchant-owned resources.
- Keep payment rails/assets and other read-only capability catalogs global.
- Keep platform permissions separate from merchant-scoped permissions while
  using the existing RBAC primitives and permission masks.
- Derive merchant and environment from the authenticated API key for merchant
  APIs. Never trust a merchant identifier supplied by an API request.
- Store the selected merchant/environment for authenticated UI requests in a
  validated, signed HttpOnly context cookie. The selection scopes data only; it
  never changes the user's effective platform permissions.
- Migrate existing data into a generated default merchant's production
  environment. Existing API keys and order URLs remain valid.

## Tenant Model

### Merchant and environments

Add `merchants` with `id`, `slug`, `name`, `status`, `created_by_user_id`, and
timestamps. Merchant status is `active` or `suspended`.

Add `merchant_environments` with `id`, `merchant_id`, `code` (`sandbox` or
`production`), `status`, and timestamps. A unique constraint on
`merchant_id + code` guarantees exactly one row per environment. Environment
status is `active` or `suspended`.

The environment row is the canonical scope key. Merchant-owned tables may keep
both `merchant_id` and `environment` for query locality and explicit checks,
with a foreign key to the environment where SQLite constraints allow it.

### Membership and roles

Add `merchant_memberships` with `merchant_id`, `user_id`, `status`, invitation
metadata, and timestamps. A unique constraint prevents duplicate membership.

Extend the existing role model so a role is either platform-scoped or attached
to one merchant. Merchant role names are unique within a merchant; the built-in
merchant owner role cannot be deleted or disabled while it is the last owner.
Existing `role_permissions` and `user_roles` remain the permission primitives,
with membership validation added to merchant-scoped role evaluation.

Platform users keep the existing global roles. Merchant access is the union of
the user's enabled roles for the selected merchant plus platform permissions.
There is no current-role permission state.

Default merchant roles are `owner`, `admin`, `operator`, and `viewer`. Their
permission masks are seeded through the existing permission registry. The owner
can invite/remove members and manage merchant settings; viewer is read-only.

## Merchant-Owned Data

The following resources receive merchant and environment scope:

- API keys and their encrypted credentials
- receiving methods and receiving-method assets
- payment ingresses and ingress credentials
- orders, idempotency keys, and merchant-facing order metadata
- outbound webhook events, deliveries, attempts, and merchant callback state
- merchant payment settings, rate adjustments, branding, and operational
  settings
- merchant Telegram bots, notification bindings, and merchant order commands

Payment rails, payment assets, permission registries, locale catalogs, and
platform operational telemetry remain global. Child payment records that are
reachable only through an order may inherit scope through their foreign key;
queries that list them must still join through the scoped order.

Every new or modified unique index is reviewed for merchant/environment scope.
Examples include API idempotency, external order IDs, receiving targets, and
provider source identifiers. Indexes must start with scope columns when the
query filters by them.

## Request and Authorization Context

### Merchant API

`authenticateGmpayParameters` and `authenticateEpayParameters` return
`merchantId`, `environmentId`, and an environment code in addition to the
existing API key principal. All order, payment-option, callback, and webhook
services receive this immutable context.

The existing API paths and request/response formats remain unchanged. Sandbox
and production are selected by the API key. A production key cannot access
sandbox rows, and a sandbox key cannot create or query production rows.

The order service requires a scoped context for every merchant operation. A
missing context is a structured authorization error, not a fallback to global
data. Resource-not-found responses do not reveal whether a resource exists in
another merchant or environment.

### Authenticated UI

Add a merchant context loader that validates the signed context cookie against
the current user and merchant membership. Platform administrators may select
any active merchant; other users may select only an active membership.

Add an environment context loader that permits only active environments of the
selected merchant. Context-changing requests require the existing trusted
Origin/CSRF protections and produce audit entries.

Existing admin server functions must obtain both platform permission and, when
the resource is merchant-owned, a validated merchant context. Client-side
hiding is not an authorization mechanism.

## Registration and UI

Add `/sign-up` using Better Auth credentials. Registration creates the user and
merchant records in one transaction, creates both environments, adds the user
as owner, and redirects to merchant onboarding. It is not an approval queue.

Add a platform merchant management page at `/admin/merchants` for creation,
suspension, environment suspension, and membership visibility. Add a merchant
switcher and sandbox/production switcher to the authenticated shell. Existing
resource pages keep their semantic routes but use the selected context.

The API key page shows an environment badge and creates keys only for the
currently selected environment. Merchant member management is scoped to the
selected merchant. Platform views may explicitly select a merchant and are
audited.

## Migration

The migration is forward-compatible and must run before application code starts
requiring non-null scope:

1. Create merchant, environment, and membership tables.
2. Create one default merchant and sandbox/production environments.
3. Bind all existing enabled users to the default merchant as owners or
   platform administrators according to their existing roles.
4. Backfill existing API keys, payment configuration, orders, webhooks,
   Telegram configuration, and settings to the default merchant's production
   environment.
5. Add scope columns and backfill them for all existing rows.
6. Create scoped indexes and replace unsafe global uniqueness constraints.
7. Verify row counts, null/orphan records, duplicate scoped keys, and query
   plans before enabling the new code path.

The migration must be idempotent where supported by the migration runner and
must not delete the source rows. Cloudflare remote migration runs only through
the maintained predeploy path after a backup/evidence check. Bun import/export
uses the existing manifest and checksum validation.

## Error Handling and Security

- Missing, suspended, or malformed context fails closed.
- Membership and environment status are checked on every server entry point.
- Cross-merchant resource access maps to a generic not-found or access-denied
  domain error.
- Merchant context, membership changes, environment status changes, API key
  lifecycle, and platform cross-merchant actions are auditable.
- Rate limits and idempotency are scoped by merchant, environment, and API key
  where applicable.
- Webhook callback validation and retry policies remain unchanged, with scope
  carried by the stored order and delivery records.
- No decrypted credential, session token, or API secret enters context cookies,
  cache keys, or logs.

## Verification

Focused tests cover schema/migration backfill, membership/role evaluation,
context-cookie validation, API-key scope derivation, order and idempotency
isolation, webhook isolation, sandbox/production separation, and legacy API
compatibility. Security tests attempt cross-merchant reads and writes through
both server functions and HTTP endpoints.

End-to-end tests cover registration, automatic environment creation, member
invitation, multi-merchant switching, environment switching, API-key creation,
and checkout access.

Run the final repository gates on the final tree:

```text
bun run typecheck
bun run test
bun run check
bun run build
bun run build:bun
```

Release verification includes remote D1 migration output, Cloudflare Worker
version output, GitHub commit parity, production health, and live checks that a
sandbox key and production key cannot cross scopes.

## Implementation Phases

1. Schema, migration, scope types, and context primitives.
2. Membership/merchant RBAC and registration transaction.
3. API key, order, payment, webhook, and Telegram scope propagation.
4. Merchant/environment selectors and scoped admin pages.
5. Isolation tests, migration rehearsal, deployment, and production smoke.

Each phase keeps the previous application path working until its replacement
has an integration test and a rollback-safe migration step.
