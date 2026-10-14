# Architecture

## Shape

Multi-tenant SaaS with a shared core workflow and configurable industry packs. Deterministic services for anything authoritative (state transitions, pricing, orders); agents only where reasoning, extraction, classification or natural language adds value.

```
Owner Copilot / Orchestrator
  Revenue | Operations | Finance | Service      (only Revenue in V1)
Shared business memory + policy + audit layer
Email | WhatsApp | Web | Files | Tally/Zoho | APIs
```

## Stack (V1)

| Layer | Choice |
| --- | --- |
| Web | Next.js + TypeScript (`apps/web`) |
| AI/backend | Python + FastAPI (`services/ai-api`) |
| DB/Auth/Storage | PostgreSQL via Supabase, Supabase Auth, RLS (from T002) |
| LLM runtime | Provider-neutral adapter behind an internal interface (from T006) |
| Agent orchestration | Explicit app-owned loop (decided in T006, ADR 0013 M2 note 1); no agent framework |
| Durable workflows | Temporal only when multi-day approvals/retries appear. Deferred. |
| Email | Resend or Postmark behind `EmailProvider`; benchmark one, then choose |
| WhatsApp | Official Business Platform/BSP only. Never unofficial automation. |
| Accounting | TallyPrime adapter, Zoho Books later, only when a pilot needs it |
| Testing | pytest, vitest, agent eval dataset |

Not used: Kubernetes, a separate vector DB (pgvector only if retrieval is proven necessary), LangGraph, a custom foundation model.

## Repository layout

```
apps/web/              Next.js / TypeScript
services/ai-api/       FastAPI / Python
packages/contracts/    shared schemas/types
supabase/              migrations/, tests/   (T002)
docs/                  product.md, architecture.md, agents/, adr/
tests/                 integration/, evals/
scripts/
```

## Core data model (introduced across T002-T004)

tenants, users, companies, contacts, products, leads, opportunities, requirements, quotes, quote_lines, orders, messages, documents, tasks, approvals, agent_runs, audit_events. Every business-owned row carries `tenant_id`. Extracted facts keep source IDs and confidence.

## Packs and modules (job CK, ADR 0084 parts 1 and 2)

A business type is **data**: `packages/packs/<id>/pack.json` (checked in CI), synced into the `packs` schema by generated migrations (a synced version is never edited). Each workspace is pinned to one pack version. A pack switches **modules** on; everything else is off and **refused in the database** (`app.module_enabled`, a before-insert guard on every module-owned table, SQLSTATE SM701). No code reads a pack id; modules are the only extension point. The default pack (textiles) is today's behaviour, and every workspace that existed before runs it. Custom fields, selling units, the labelled example data and a 5,000-row import are the first things built on it. See `docs/runbooks/add-a-business-type.md`.

## Building materials (job CN, ADR 0085)

A second, separate deterministic calculator (`packages/quote-engine`, `quote_engine.construction`, with a TypeScript twin and an SQL twin `app.cq_compute`) prices area-based material orders: area x pieces per area x (1 + wastage), optional pallets, transport, handling, laying and GST per item. **The database builds the request from its own sources and recomputes the figures; the API only compares**, so a quote that is not the calculator's and the database's agreement is never stored. Material quotes have their own tables; an order comes from either kind of quote (exactly one). A customer has many sites; an order has trips with proof of delivery; invoices and payments give a FIFO dues ledger and a credit warning; a trip update reaches the site contact only through the outbox. The Requirement Analyst runs a second version of the same agent for a workspace with the `materials` module. The saree quote engine (pinned v1.1.0) is untouched. See `docs/runbooks/construction-materials-core.md`.

## Shared ledger and reminder campaigns (job CP, ADR 0086)

One receivables ledger serves construction dues and education fees: accounts for a company or a contact; charges, payments (with a receipt number per business per financial year), adjustments and concessions; credits go to the oldest claim first. Amounts come only from entries and imports a person made, never from a model. **Reminder campaigns** build on it and on the outbox: a list (an import, or everyone the ledger says owes something due in a range), one approved WhatsApp template, one fixed text with merge fields, up to five steps as offsets from each person's own date. **The Owner approves the whole campaign once, with a second factor, for the rendered samples they saw; the approval binds to a hash of everything that can reach a person, and any change returns it to draft.** The scheduler worker hands each due step to the outbox as an ordinary message with an id derived from (campaign, person, step, date), under every per-message rule (consent, STOP, quiet hours, the daily limit, both kill switches); a person who has not replied and has not paid becomes an item on the call list (staff call through the bridge and record the outcome). Results are derived from the outbox and the WhatsApp status table. The money rule is the owner's decision, ACCEPTED pending the lawyer (ADR 0066 addendum).

## Quote engine

source requirement -> validated structured fields -> approved catalog/rule/history lookup -> deterministic calculation service -> AI explains assumptions and missing inputs -> human review -> versioned approval -> PDF/email draft. Semantic similarity never chooses a price. Every quote line records its rule/source. Discount authority belongs to RBAC/policy.

## Security baseline

- Tenant isolation via Postgres RLS plus server authorization, with allow/deny tests.
- Secrets server-side only; service-role keys never reach the browser.
- RBAC: Owner/Admin/Sales/Viewer minimum; action permissions separate from read.
- Append-only style audit events for important actions.
- Uploads: type/size validation, isolated parsing, no code execution.
- Prompt injection: documents and messages are untrusted data.
- Tenant data export and deletion workflow before external pilots.

## Compliance notes

Engineering baseline, not legal advice. India: DPDP Rules 2025 and TRAI UCC/consent rules shape outreach and data handling (consent and suppression state are first-class records). Get India-qualified legal review before external production data or scaled outreach.

## Command Center UI build order

UI-0 tables/forms -> UI-1 Revenue department agent cards -> UI-2 Owner/Brain card -> UI-3 Doing/Next/Done/Waiting Approval/Failed counters -> UI-4 Operations/Finance (only when built) -> UI-5 visual "AI company" view (original design, only once it reflects real capabilities).

## Decisions

Architecture decision records live in `docs/adr/`. Add one whenever a decision above changes.
