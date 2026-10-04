# ADR 0012: Web Lead Review Queue UI (T005 Milestone 3)

Status: accepted for milestone 3 (Web UI). Builds on ADR 0007 (Web CRM UI), ADR 0009 (Web Evidence Pages), ADR 0010 (Lead Review Database Model), and ADR 0011 (Lead Review API Layer).

## Context & Objectives

Ticket T005 Milestone 3 delivers the user-facing web interface for human lead qualification and Ideal Customer Profile (ICP) review within `apps/web`:
1. **Unbiased Human Evaluation (Blind Mode):** A human reviewer evaluates candidate leads without being primed by the deterministic ICP score. Blind mode is enabled by default (`?blind=true`), keeping unreviewed lead scores hidden until labeled. Reviewers can explicitly toggle blind scoring off when desired.
2. **Review & Labeling Workflow:** Interactive, accessible buttons for Good, Bad, and Maybe. Marking a lead as Bad strictly requires selecting one of the 11 database-enforced reason codes (`not_our_market`, `wrong_product`, `too_small`, `too_large`, `inactive`, `not_a_business`, `no_contact_route`, `already_customer`, `duplicate`, `insufficient_info`, `payment_risk`).
3. **Evidence & Provenance Inspection:** Direct links to lead evidence detail pages (`/app/tenants/[tenantId]/leads/[leadId]`), displaying verified snippets, claims, and provenance without rendering raw HTML or untrusted URLs as hyperlinks.
4. **Candidate Lead Batch Import:** A client-side form supporting preview dry-runs and commit runs for batches of up to 500 JSON rows, surfacing deduplication and error counts immediately.
5. **Secure Dataset Export:** Route handler `/app/tenants/[tenantId]/review/export` allowing Owner and Admin roles to download CSV and JSON datasets, protected against spreadsheet formula injection (`=`, `+`, `-`, `@`, `\t`, `\r` prefixed with `'`).
6. **Zero AI / Zero LLM:** The entire queue, scoring display, and labeling flow operate without any generative AI or LLM involvement.

---

## Architectural Decisions

### 1. Server Components & Progressive Enhancement
- The Review Queue page (`apps/web/app/app/tenants/[tenantId]/review/page.tsx`) is a Next.js Server Component that fetches the active ICP config and candidate review queue directly through the authenticated backend API.
- Search parameters (`?blind=true|false`, `?score_band=priority|...`, `?cursor=...`) drive server-side filtering and pagination with zero client-side state drift.
- Writable forms use Next.js Server Actions with `useActionState` and optimistic UI in client subcomponents (`lead-label-form.tsx`, `import-leads-form.tsx`).

### 2. Authorization & Role Matrix
- **Tenant Isolation:** Every request verifies tenant membership via `fetchTenant()`. Unknown or foreign tenant UUIDs return a 404 response immediately.
- **Role Enforcement:**
  - **Owner / Admin:** Full access to review queue, label actions, lead imports, and dataset exports (CSV/JSON).
  - **Sales:** Can view review queue, label leads (Good/Bad/Maybe), and import lead batches. Dataset exports are refused with 403 Forbidden.
  - **Viewer:** Read-only queue access. Labeling controls, import form, and export buttons are hidden and rejected by the API if attempted.

### 3. Blind Scoring & Confirmation Bias Mitigation
- To ensure human reviewers evaluate company and evidence details objectively:
  - Blind mode is on by default (`blind !== "false"`).
  - When blind mode is active, the review queue API omits scores for unreviewed leads, and the UI displays an explicit "Score Hidden (Blind)" badge.
  - Once a lead is labeled, its score and deterministic factor breakdown are rendered.
  - Reviewers can toggle blind mode off at any time using the header badge button (`?blind=false`).

### 4. Guard Rails & Defense in Depth
- **Formula Injection Immunity:** Export route handler delegates file generation to backend `/v1/tenants/{tenantId}/exports`, which prefixes dangerous spreadsheet characters with a single quote (`'`).
- **Secret Separation:** No database connection strings, service-role keys, or JWT signing secrets exist in `apps/web`.
- **Untrusted Content Safety:** Candidate URLs, notes, and evidence text are rendered strictly as plain text child nodes (`guards.test.ts` enforced).
- **Navigation Placement:** Lead Review Queue link is placed in a dedicated `<nav aria-label="Lead actions">` container, keeping the core CRM records navigation clean and maintaining contract separation.

---

## Verification & Status

All components and workflows are verified end-to-end:
- **Unit & Contract Tests:** 457 Vitest tests passing across 24 test files in `apps/web` (including 26 security guard tests in `test/guards.test.ts`).
- **Type Safety & Linting:** 0 TypeScript errors (`npm run typecheck`), 0 ESLint errors (`npm run lint`), and 0 Ruff/Mypy errors in backend.
- **Database & RLS Isolation:** 4,077 pgTAP tests passing in `supabase/tests/database`.
- **Full Integration Suite:** 311 integration tests passing against real local Supabase stack (`make test-integration`).
