# Sme-AI plan v2: local-first (decided 2026-10-05)
## Decision
No production deployment yet. No paid infrastructure, domain, SMTP, family accounts or real customer data until the full Revenue Engine works end to end locally on synthetic data. Supabase stays local (Docker) / Free plan for development.
## Sequence
1. T006 / T006b: done (agent runtime, erasure, real-data gate, MFA, auth routes, headers). Only housekeeping left: push + CI green.
2. T007 Research Agent (plan first, then M1 interfaces + safe fetch, M2 agent + claim resolution + score test, M3 review UX + evals, M4 live smoke only with owner approval).
3. T007b Lead discovery (search-based; search provider proposed and approved at that point).
4. T008 Requirement Agent.
5. T009 Quote Engine (deterministic).
6. T010 Follow-up Workflow (needs suppression HMAC first).
7. Order conversion.
8. T011 Owner Agent / brief.
9. Customer Zero stage (T012): hosting (Supabase Pro Mumbai + Cloud Run), domain, SMTP, family accounts, production secrets, restore drill, hosted verifier, DPDP review, gate opened with all four prerequisites, real data.
## Rules
- Synthetic/test data only until security, RLS, audit logging and the core workflow are validated. The real-data gate stays closed by default.
- Any paid dependency (LLM, search, hosting): provider behind an interface; owner receives exact provider, why needed, estimated dev cost, free tier; owner approves before it is introduced.
- Credentials: privileged server-side keys never in browser code, Git, committed .env or client JS. Where a backend truly needs privileged access, the secret lives in Google Secret Manager (or equivalent) and the use is recorded in an ADR with a narrow path. Default stays the delegated user JWT + RLS. Prefer the publishable/secret key naming over legacy anon/service_role.
## Open at the Customer Zero stage
Restore drill, hosted verify run, hosted Auth settings, SMTP, MFA enrolment of real users, DPDP review (start it weeks before), key-model migration, workspace-creation policy for external customers, suppression HMAC before first outreach.
