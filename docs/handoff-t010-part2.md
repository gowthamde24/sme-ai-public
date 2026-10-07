# Hand-off: T010 part 2 (touches, cadence policy, follow-up drafts, question drafts)

Branch `t010-part2` (commits 1 to 6; nothing is pushed, no remote was changed, nothing is deployed). Everything here is local, synthetic and sends nothing. The decisions are in `docs/adr/0022-touches-cadence-follow-up-drafts.md` (read its "Final state" section first); the plan is `docs/plans/t010-integration.md`; the mutation notes are `docs/checklist-notes/A.md` ("T010 part 2 (commits 1-4d)").

## What is built

**Database** (five migrations; pgTAP files 62-65). Touches (`lead_touches`, append-only), the cadence policy (`followup_policy_versions`, immutable, versioned), follow-up drafts (`followup_drafts`: waiting, approved, recorded as sent, discarded; one active draft per lead and touch number), question drafts (`question_drafts`), the closed wording templates (`followup_templates`) and the engine allow-list (`followup_engine_versions`). Nine SECURITY DEFINER functions (`create_followup_policy_version`, `followup_gate`, `record_touch`, `create_followup_draft`, `approve_followup_draft`, `discard_followup_draft`, `record_draft_sent`, `persist_question_drafts`, `decide_question_draft`), each with an empty search_path, the role proven first, then the second factor, then the specific refusals (SM220 to SM229). The gate (suppression, keys, consent) and the stops (orders, a withdrawn quote, an archived lead) are repeated at every step. The database rebuilds the engine's request itself and decides whether a draft is due by the engine's own rules (the equivalence gate proves both agree).

**API** (`services/ai-api/app/followups/*`; endpoints under `/v1/tenants/{tenant_id}`): policy versions, a lead's follow-up page (the gate, the guidance, the touches, the drafts), touches, drafts (create, approve, discard, "I sent it"), the due list, question drafts (sync, approve, discard). The pinned cadence engine is reached only through the adapter (version allow-list, hash recomputed, fail closed). The API never decides: it passes the person's own token and the engine's answer; the database recomputes and refuses any difference. A stopped or blocked lead is never offered as due (the gate is read first).

**Web** (plain screens, no design work: the design v2 port is its own ticket): the lead's follow-up page, the due list, the policy page, the question drafts of a requirement, entry links from the workspace home, the lead and the requirement panel. One strings module (one fixed sentence per refusal; never the server's text); logic apart from markup; no field for wording; no "send" button; every screen says follow-ups are drafts for a person to send outside the system.

**Rehearsal and proofs.** `make rehearse-followups` (the whole journey headless, every refusal asserted, and that nothing could have sent), `make rehearse-prepare-followups` (ten leads in ten states for the owner to click: `docs/rehearsal-followups-checklist.md`), the equivalence gate, race tests, pgTAP, the mutation pass and its tools (`tools/mutation-followups/`, opt-in, about 45 minutes).

## How to check it (from the repository root)

```
make check                                      # lint, types, unit, pgTAP, integration, evals (the definition of done; needs Docker and `supabase start`)
make rehearse-followups                         # headless journey; writes rehearsal-followups-report.md (git-ignored)
make rehearse-prepare-followups                 # a new synthetic workspace to click through (docs/rehearsal-followups-checklist.md)
python3 tools/mutation-followups/run_sql.py     # opt-in mutation pass (see its README)
```

`make eval-live` (the opt-in live-model evals) is not part of any of this and has never been run.

## Deliberately NOT built

* **Any sending.** No e-mail, WhatsApp or SMS client, no provider interface was added; a touch, a draft and an approval are records. "Record: I sent it myself" is a person's word.
* **A scheduler or an agent.** The due list is computed when the page is opened.
* **Free-text wording.** A draft's text is a closed template the database copies; a question's text is a closed template of the requirement mapper. Languages other than English are not built.
* **A model call or a network call** beyond the local stack.
* **Design.** The screens are plain and functional; the lead's name is not shown on the follow-up page or the due list (the checklist works around it with printed addresses).

## OPEN list (each is also a row of `docs/pre-pilot-checklist.md` where it has a gate)

1. **CLOSED by the followups-whatsapp ticket (2026-10-07; ADR 0022 addendum): WhatsApp is a first-class channel** (one due row per lead with each channel's state, E-mail and WhatsApp tabs, a default channel, a draft form with a fixed channel; no migration). What remained from it: the due list's bound of 30 candidates (closed by the followups-due-candidates ticket, ADR 0022 addendum 2) and the WhatsApp wording. The original item, kept for the record: the due list judged leads on e-mail only (it reads the gate for `email`); the lead page reaches WhatsApp only by `?channel=whatsapp` (there is no channel switch); so a lead with only a phone number never appears in the due list. A shared phone number blocks WhatsApp only (the API refuses a second contact with the same e-mail address, but allows a shared number), and a lead blocked only on WhatsApp stays in the due list. Make WhatsApp first-class (a channel switch on the lead page, a due list across channels) **before Customer Zero**. Not built.
2. **No screen to record suppression keys.** The endpoints exist (`POST /suppression/backfill`, Owner with a second factor; `GET /suppression/status`, Admin or Owner) and nothing in the web calls them. A contact with no key (made while the API had no `SUPPRESSION_HMAC_KEY`, or straight through PostgREST) can never receive a follow-up draft (SM221); the screens say so honestly ("Recording keys for existing contacts is not available on any screen yet."). Build a plain Owner screen **before the first outreach**.
3. **The bound of 100 touches makes the "I sent it" 500-touch cap unreachable.** The cap (SM229) in `record_draft_sent` can only be reached with more than 99 touches on a lead, which the policy's bound forbids. The bound is pinned by pgTAP 62 O9, O10 and O50 and by the web policy form's "the touch count is 1 to 100" test. **If one of them has to change because the bound is raised, revisit the 7 equivalent mutants of `record_draft_sent` in `docs/checklist-notes/A.md`.** Owner: the next ticket that touches policy bounds.
4. **`SUPPRESSION_HMAC_KEY` hosting.** The key is a secret (one per environment, in the API's configuration only, never in the repository, a log, a response or a URL; a leaked key lets someone test whether an address was suppressed). The API checks the current key and one previous version; keep every old key as long as its events matter (erased contacts cannot be re-keyed). Outside development the process refuses to start without it; in development, with no key, contacts are created unkeyed and are blocked from follow-ups. The rehearsal uses a synthetic, non-secret key. Where the real key lives is a Customer Zero decision.
5. **The real policy values.** The rehearsal's policy is synthetic (gaps of 1 and 2 days, three touches, quiet hours 03:00 to 04:00, every weekday, no holidays, no minimum gap, an offset that makes the recipient's clock read noon). The family's real gaps, touch limit, quiet hours, weekdays, holidays, minimum gap and the recipient's UTC offset are the owner's to decide; the policy page lets the Owner publish a version (with the authenticator app) and never edits one.
6. **The closed wording.** The three draft templates and the question templates are synthetic placeholders; the real wording, and whether any of it needs a lawyer's reading (consent and do-not-contact rules), is the owner's. Nothing here is legal advice and no default legal basis is coded.
7. **Option B before the first scheduled agent and before any external customer** (ADR 0013, ADR 0022): a service principal that alone holds EXECUTE on the key-recording and question-persisting functions. Under option A a member who talks to PostgREST directly can record a wrong key or store another closed-looking question.

## What the tests found that you should know about (all fixed)

* A retry of "ask for a draft" more than a second later got `409 conflict` instead of a replay (found by the rehearsal driver; commit 4d, one function, a new migration, pgTAP and integration tests).
* The engine does not know about orders or keys, so a lead with an accepted order, an opted-out contact or a shared suppressed key read "a draft can be made now" and was listed as due while the database would refuse; the stop and the gate now come first (commits 4b, 4c).
* `app.followup_blocker_inner` judged a request with no `holidays` key as due (not reachable through the API; commit 5, one function, a copy test).
* An erased-by-right marker on a shared key must read as plain `key` to a client; held in the database, the API and the web, with tests.

## Where things are

`supabase/migrations/20261024090000` to `20261027090000` (the `t010_part2_*` files) · `supabase/tests/database/62` to `65` · `services/ai-api/app/followups/` and `tests/test_followups_*.py` · `tests/integration/test_followup_*.py` · `apps/web/app/app/tenants/[tenantId]/followups/`, `apps/web/lib/api/followups*.ts` · `tests/rehearsal/followups.py` · `docs/rehearsal-followups-checklist.md` · `tools/mutation-followups/` · `docs/adr/0022-touches-cadence-follow-up-drafts.md`.
