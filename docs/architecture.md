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
| Agent orchestration | OpenAI Agents SDK or explicit app-owned loops; decide in T006, do not mix frameworks |
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
