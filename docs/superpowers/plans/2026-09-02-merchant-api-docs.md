# Merchant API Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a complete GMPay and EPay integration guide beside the interactive OpenAPI reference at `/docs`.

**Architecture:** Keep the paired Markdown merchant guides as the human-readable source and render the selected guide at build time with the existing `react-markdown` dependency. Keep `public/openapi.yaml` as the machine-readable contract and extend the existing docs client page with a guide section and an OpenAPI reference section; do not add a router or runtime documentation service.

**Tech Stack:** React 19, TanStack Start, Scalar API Reference, react-markdown, Paraglide, OpenAPI 3.1, Vitest, Biome, Bun, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-02-merchant-api-docs-design.md`

## Global Constraints

- GMPay remains the primary protocol; EPay remains a compatibility adapter over the shared order and Webhook pipeline.
- API credentials are merchant- and environment-scoped; documentation never embeds real secrets.
- Public paths, signing rules, status values, error codes, callback acknowledgement, and retry behavior must match the existing handlers.
- User-facing labels introduced in the docs shell use Paraglide; protocol field names and code examples remain literal.
- Preserve the existing Scalar theme integration, responsive behavior, and client-only loading boundary.
- Run focused tests, `bun run typecheck`, `bun run check`, `bun run build`, `bun run build:bun`, and browser verification before release.

---

### Task 1: Expand the human-readable merchant guides

**Files:**
- Modify: `docs/zh-CN/MERCHANT_API.md`
- Modify: `docs/en-US/MERCHANT_API.md`

**Interfaces:**
- Produces the build-time Markdown content rendered by `MerchantApiGuide`.
- Must describe the exact paths and fields implemented by `gmpay-api.ts`, `epay-adapter.ts`, `gmpay-signature.ts`, and `webhooks/server/delivery.ts`.

- [ ] **Step 1: Add the integration quick start**

Document the base URL, sandbox versus production API credentials, merchant/environment isolation, required scopes, and the five-step flow: create credential, configure receiving method, create signed order, open `payment_url`, and process callbacks.

- [ ] **Step 2: Add complete GMPay request and response sections**

Document JSON and form requests, every accepted field and constraint, optional token/network selection, selectable checkout behavior, response fields, integer and detailed statuses, query selectors, and timeout recovery.

- [ ] **Step 3: Add complete EPay compatibility sections**

Document submit GET/form POST, MAPI response differences, query API, `type=asset.network`, `alipay` selection, MD5 canonicalization, field mapping, and legacy `trade_status` values.

- [ ] **Step 4: Add signing and callback examples**

Include copyable `curl`, Node.js/TypeScript, and PHP examples for GMPay HMAC-SHA256 and EPay MD5, plus callback verification with constant-time comparison, plain-text acknowledgement, duplicate handling, and retry guidance. Use placeholders only.

- [ ] **Step 5: Add status, error, idempotency, security, and go-live tables**

Describe `status_code`/`code`, `request_id`, external-order idempotency, API rate limits, SSRF-safe HTTPS callbacks, secret storage, webhook response rules, and a sandbox-to-production checklist.

- [ ] **Step 6: Format and inspect both guides**

Run `bunx biome format --write docs/zh-CN/MERCHANT_API.md docs/en-US/MERCHANT_API.md` and inspect headings, links, code fences, and placeholder scanning.

### Task 2: Align the OpenAPI contract

**Files:**
- Modify: `public/openapi.yaml`

**Interfaces:**
- Produces the contract consumed by Scalar at `/openapi.yaml`.
- Paths and schemas must remain compatible with the existing public route handlers.

- [ ] **Step 1: Correct API identity and deployment model**

Update title, description, server placeholder, and multi-merchant/environment wording so the document no longer claims a single-tenant gateway.

- [ ] **Step 2: Complete GMPay and EPay operation descriptions**

Add exact request constraints, form/JSON content types, required and optional fields, query selector rules, signing exclusions, MAPI response shape, and callback acknowledgement descriptions.

- [ ] **Step 3: Complete schemas and reusable errors**

Ensure response schemas include all fields returned by the handlers, current detailed statuses, EPay `code`/`msg` fields, `request_id`, error examples, and callback payloads without inventing unsupported fields.

- [ ] **Step 4: Add contract regression tests**

Create `tests/unit/docs/merchant-api-contract.test.ts` that parses the YAML as text and asserts all merchant paths, required fields, callback definitions, status enums, and multi-merchant wording. Keep the test deterministic and independent of network access.

### Task 3: Render the guide at `/docs`

**Files:**
- Create: `src/features/docs/merchant-guide.tsx`
- Modify: `src/features/docs/api-reference-client.tsx`
- Modify: `messages/en-US.json`
- Modify: `messages/ja-JP.json`
- Modify: `messages/ko-KR.json`
- Modify: `messages/ru-RU.json`
- Modify: `messages/zh-TW.json`
- Modify: `messages/zh-CN.json`

**Interfaces:**
- `MerchantApiGuide` accepts no secrets or runtime data and renders the selected build-time Markdown string.
- `ApiReferenceClientPage` keeps Scalar's existing configuration and adds the guide/reference navigation.

- [ ] **Step 1: Add the failing guide-content test**

Create `tests/unit/docs/merchant-guide-content.test.ts` that reads both Markdown files and asserts the two protocol paths, HMAC/MD5 rules, callback acknowledgement, idempotency, status/error sections, and `curl`, Node.js/TypeScript, and PHP examples.

- [ ] **Step 2: Implement the Markdown guide component**

Import `docs/zh-CN/MERCHANT_API.md?raw` and `docs/en-US/MERCHANT_API.md?raw`, select Chinese for `zh-CN` and English as the safe fallback, and render headings, paragraphs, tables, links, and code blocks with existing design tokens and accessible heading structure.

- [ ] **Step 3: Add the guide/reference shell**

Add Paraglide labels for “Merchant integration guide”, “Interactive OpenAPI reference”, and the two navigation links. Render the guide before Scalar in the same route, keep Scalar lazy/client-only, preserve `resolvedTheme`, and make the layout usable on mobile and both themes.

- [ ] **Step 4: Compile messages and run focused tests**

Run `bun run generate-paraglide`, `bunx vitest run tests/unit/docs/merchant-api-contract.test.ts tests/unit/docs/merchant-guide-content.test.ts`, `bun run typecheck`, and `bun run check`. Fix only caused failures.

### Task 4: Verify, commit, and release

**Files:**
- No additional source files; use the current tree from Tasks 1-3.

**Interfaces:**
- Delivers the updated `/docs` page, `/openapi.yaml`, and GitHub/Cloudflare release.

- [ ] **Step 1: Run the final quality gate**

Run `bun run test`, `bun run build`, and `bun run build:bun` with the project Node runtime. Record any pre-existing network-only test limitation separately from changed behavior.

- [ ] **Step 2: Verify the deployed browser experience**

Open `/docs` in the authenticated browser, check guide headings and code blocks, the OpenAPI reference link, light/dark themes, mobile viewport, and `dev.logs({ levels: ["error", "warn"] })`. Do not execute payment operations.

- [ ] **Step 3: Run remote predeploy and commit**

Run `bun run predeploy`, inspect `git diff --check` and `git status`, then commit with `docs: publish merchant api integration guide`.

- [ ] **Step 4: Push and deploy**

Push `main` to `origin`, run `bun run deploy`, verify the active Wrangler deployment and `curl -fsS https://pay.gelooss.com/status`, then report the commit, deployment version, and browser evidence.
