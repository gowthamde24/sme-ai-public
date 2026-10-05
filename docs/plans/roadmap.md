# Roadmap (local-first), decided 2026-10-05

ADR 0017 governs this sequence: synthetic data only, no deployment, no paid dependency without the owner's prior approval, and the real-data
gate closed. Each ticket is one ticket at a time, with a hard stop for the owner's review at its milestones (CLAUDE.md working rhythm).

| Order | Ticket | Delivers | Build and test needs | Live (needs owner approval) |
| --- | --- | --- | --- | --- |
| done | T001-T006, T006b | monorepo, tenancy/RLS, CRM, evidence, lead review, agent runtime, erasure, real-data gate, MFA, auth routes, headers | local Supabase (Docker) | none |
| 1 | **T007 Research Agent** | agent that reads a lead's own website and proposes evidence and claims; safe fetcher; web-content injection evals; golden set | fakes and fixtures only | M4 only: a model key (about 5 leads, tiny budget) |
| 2 | **T007b Lead discovery (search-based)** | candidates from a permitted search source into the import path | SearchProvider fake | a search API (free tier first) |
| 3 | **T008 Requirement Agent** | enquiry/RFQ text to a structured requirement; low-confidence fields flagged; human confirms | fixtures; model fake | model (same key as T007) |
| 4 | **T009 Quote Engine** | deterministic pricing service; versioned approval; AI only explains | none (no model decides a price) | none |
| 5 | **T010 Follow-up** | tasks and drafts from state and consent; outreach drafts; auto-send OFF; suppression list (HMAC, ADR 0014) before any first outreach | `EmailProvider` fake, Mailpit locally | none until Customer Zero |
| 6 | **Order conversion** | won/lost, order record, source trail; deterministic and idempotent | none | none |
| 7 | **T011 Owner Agent** | read-only daily brief, metrics and attention list from real backend state | model fake | model (optional) |
| 8 | **T012 Customer Zero stage** | everything deferred: staging deploy, hosted verifier run, restore drill, hosted Auth settings, SMTP and domain, MFA for real users, DPDP review, opening the gate for one new workspace, four-week measurement against a baseline | the deploy tooling already in `deploy/` and `scripts/verify_hosted.py` | hosting, SMTP, domain, legal review |

## What stays local and free throughout
Supabase local stack (Postgres, GoTrue, PostgREST, Mailpit for Auth e-mail), Next.js and FastAPI dev servers, fixture web pages under a
reserved test domain, scripted and fake models, pgTAP, pytest, vitest, the containment evals (`make eval`).

## Gates between tickets
* Every ticket: `make check` passes, new behaviour has tests (authorization, idempotency, structured outputs), a short risk summary.
* Before any live model call: the owner approves provider, key, model id, prices and a provider-side hard spend cap (ADR 0017 b).
* Before any real person's data: every row of `docs/pre-pilot-checklist.md` labelled **Before real data** is closed or accepted in writing.
* Hosting recommendation (ADR 0015): kept, **deferred; re-check prices at T012**.
