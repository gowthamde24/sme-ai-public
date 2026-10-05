# ADR 0017: Local-first sequence, provider approval and credential policy

Status: accepted (owner decision, 2026-10-05). Related: ADR 0013 (agents), ADR 0015 (real-data gate and hosting), `docs/plans/roadmap.md`,
`docs/plans/key-model-audit.md`, CLAUDE.md non-negotiables 2, 8 and 9.

## Context
T006 and T006b built the agent runtime, erasure, the real-data gate, MFA and the hosting tooling. The owner has decided not to pay for or
publish anything until the whole Revenue Engine works locally. This ADR records that decision and the rules that follow from it.

## Decisions
**a. Local-first, synthetic only.** Until the Customer Zero stage (T012) there is no production deployment, domain, SMTP, family account or
paid infrastructure. Supabase runs locally in Docker (or on the Free plan for development). Only synthetic data exists. The real-data gate
stays closed by default and is opened only in the Customer Zero stage, with its four prerequisites (ADR 0015). Hosting work (staging deploy,
hosted verifier run, restore drill, hosted Auth settings, SMTP, MFA enrolment of real users, DPDP review, gate opening) moves to T012. The
hosting recommendation in ADR 0015 stays as written but is **deferred: re-check prices when T012 starts**.

**b. Any paid dependency needs the owner's prior approval.** This covers an LLM, search, e-mail or SMS provider, hosting, a domain and any
SaaS. The provider sits behind an internal interface (rule 9), with an offline fake for build and test. Before it is introduced the owner
receives one short message with: the exact provider and model or plan, why it is needed, the estimated development cost, the free tier (and
what the free tier does with our data), the data-retention terms, and a hard spend cap to set provider-side. Nothing is added, signed up for
or called until the owner approves in writing. Free local tools (a local model, a fixture web server) need no approval but still need a
reason if they add a dependency (rule 8).

**c. Privileged Supabase keys.** They never appear in browser or client code, in Git, or in a committed `.env`. The default stays the
delegated user JWT plus RLS (ADR 0002, ADR 0013 option A). If a backend feature truly needs a privileged key, it lives in Google Secret
Manager (or an equivalent store), the use is recorded in its own ADR with the narrow code path and a minimal grant, and it ships only after
the owner approves. **Do not blanket-restore `service_role` writes.** The revoke in `20261012090100` stays: the need is met by a narrow
definer function or a dedicated role (ADR 0013 option B) granted only the specific tables.

**d. Naming.** Prefer the publishable / secret key names over anon / service_role in new code, docs and variables. The migration of
existing names is proposed in `docs/plans/key-model-audit.md` and supports both names for a while.

## Consequences
* The next tickets (T007 onward) are built and tested against fakes and fixtures. A live call to any provider happens only at a named
  milestone, after approval under (b).
* Checklist rows carry a phase: Next ticket, Before deploy, Before real data, Later.
* Nothing here weakens a non-negotiable. It only delays spend and exposure.

## What this does not change
Security work already done (RLS, erasure, MFA, the gate, the verifier) stays. The hosted verifier and runbooks stay in the repository for T012.
