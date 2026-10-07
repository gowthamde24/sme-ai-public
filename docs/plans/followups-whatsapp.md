# Plan: WhatsApp as a first-class channel in the follow-up screens

Status: **APPROVED by the owner (2026-10-07), with the answers and changes in the last section.** Commit 1 (API) and commit 2 (web data layer) are done; the plan itself writes no migration. Branch `followups-whatsapp` (from `main` at `2fd595b`, which already contains T010 part 2). This closes the first OPEN item of `docs/handoff-t010-part2.md` and the "WhatsApp is not a first-class channel" row of `docs/pre-pilot-checklist.md` (gate: before Customer Zero). Read ADR 0022 "Final state" first.

**Nothing sends anything.** This ticket is only about *drafting* and *recording touches* on WhatsApp the way the screens already do for e-mail: a draft is a closed template a person copies and sends outside the system; "Record: I sent it myself" is a person's word.

## 1. The problem today

What the code does, in plain words:

* **The due list looks at e-mail only.** For every lead that has an outbound touch, `due_list` (`services/ai-api/app/followups/service.py`) asks the database whether the lead may be contacted **by e-mail** (`repo.gate(token, lead_id, "email")`) and silently drops the lead if not. So a lead whose customer only has a phone number, or whose e-mail consent was never recorded or was withdrawn, **never appears in the due list**, even when WhatsApp is perfectly allowed. A lead that does appear gives no hint that WhatsApp exists, or that it is blocked.
* **The lead page reaches WhatsApp only by typing `?channel=whatsapp`.** `leads/[leadId]/followup/page.tsx` defaults to e-mail; nothing on any screen links to the WhatsApp view. The page's gate lines and its guidance are for the loaded channel, but the draft form carries its own channel select: a person can pick WhatsApp in the form while the page still shows the e-mail gate, so the screen can say "nothing blocks" about e-mail and then ask for a WhatsApp draft.
* **The capability is already in the database and the API.** `record_touch` accepts `whatsapp`; `create_followup_draft` accepts `whatsapp` (the gate reads the phone key and the WhatsApp consent); approval and "I sent it" are channel-aware (the state fingerprint includes the channel). What is missing is only what the screens ask and show.

Two facts the design rests on (both verified in the code):

1. **The cadence is per lead, not per channel.** The pinned engine (`followup_cadence` 1.0.0) counts every outbound touch of a lead, whatever its channel, and never reads the channel for its decision. A WhatsApp touch advances the cadence exactly like an e-mail. So "is a follow-up due?" is one fact per lead; only "may I contact them on this channel?" is per channel.
2. **One active draft per touch number per lead, not per channel** (the partial unique index `followup_drafts_one_active_key`, pgTAP 62 D80). A lead cannot have an e-mail draft and a WhatsApp draft for the same touch at once.

## 2. The due list across channels

### The row

| Option | What it is | For | Against |
| --- | --- | --- | --- |
| **A. One row per lead**, listing its channels with their state | one line per lead; "E-mail: open, WhatsApp: no recorded consent" | matches the engine (one decision per lead); short list; one draft per touch is already the database's rule; a person never sees the same customer twice | the row is a little richer |
| B. One row per lead *and* channel | the same lead twice when both channels are open | simple to filter by channel | the engine's answer is repeated; invites two drafts for one touch (the database refuses the second, SM223); a long list |
| C. Two lists (e-mail, WhatsApp) | tabs on the due page | channel-centred work ("do the WhatsApp round") | the same lead in both; the cadence is not channel-centred |

**Recommendation: A.** The row keeps today's fields (the engine's action and reason for the lead, the touch number, the earliest time, the open draft) and adds the lead's channels, each with `blocked` (a closed word or none), the default channel, and the channel of the open draft if there is one. A lead is **listed when at least one channel is open** and the lead is not stopped.

### The gate read per channel

The API reads `public.followup_gate(lead, channel)` for `email` and `whatsapp` per candidate (today: once, for `email`). The stop is lead-level, so a first read that says `stopped` skips the second. With the existing limit of 30 candidates that is at most 60 small reads where there were 30. **No new function is needed for this** (see section 4); if the page proves slow, the optimisation is one new read-only function that returns both channels at once, a separate decision.

### A lead blocked on one channel and open on the other

| State of the lead | In the due list | On the lead page |
| --- | --- | --- |
| open on both | listed; default channel by the rule in section 3 | two channel tabs, both open |
| open on one, blocked on the other (no consent, a shared phone number whose other contact opted out, an unkeyed phone) | **listed**, with the open channel as the default and the blocked one shown with its closed sentence | the blocked tab says why (the gate's own sentence); "Ask for a draft" exists only on the open tab |
| blocked on both | **not listed** (as today for e-mail): a blocked lead is never due | both tabs say why |
| stopped (an order, a withdrawn quote, an archived lead) | **not listed** | both tabs show the stop line only |

Why a lead blocked on one channel stays listed: the person's goal is to follow the customer up; if one door is closed and the other is open, the follow-up is still due. The database still decides again when a draft is asked for (guidance only, as today).

## 3. The lead page

### The switch

| Option | For | Against |
| --- | --- | --- |
| **Tabs that are links** (`?channel=whatsapp`), the selected tab drives the gate lines, the guidance and the forms | no client state (the page stays a server component); works without scripts; the address is shareable and bookmarkable; the existing URL keeps working | one more round trip when switching |
| A select (client state) | no reload | duplicates the server's state in the browser; this is the source of today's mismatch |
| Both channels stacked on one page | everything visible | long; two sets of forms and two gate blocks |

**Recommendation: tabs that are links**, in a fixed order (E-mail, then WhatsApp), each marked *open* or with the blocked word. **The draft form loses its channel select**: the tab decides the channel (a hidden field). This removes the screen/form mismatch and the case where one form id is re-sent for another channel (the database answers that with the constant `conflict`).

### The default channel (when the address has no `?channel=`)

The database has **no preferred-channel field** for a contact (only per-channel consent), so "the contact's preferred channel" would need a column and a screen: not part of this ticket (question 3). The API resolves the default with data it already has, in this order:

1. the channel of an **open draft** (the person is in the middle of one);
2. else the channel of the lead's **latest outbound touch** (e-mail or WhatsApp; a phone call does not count), if that channel is still open: you carry on where you last spoke to them;
3. else **e-mail** if open, else **WhatsApp** if open;
4. else (both blocked) e-mail, so the page shows the blocks.

The resolved channel is returned in the response, and the due list's row links to it.

### Also on the page

* **A draft already open on the other channel**: a line says so with a link to that tab ("A draft for touch 2 is waiting on E-mail"), and "Ask for a draft" is hidden on this tab (the database would refuse it: one draft per touch). To move to the other channel the person discards the open draft first (question 4).
* **"Record a touch"** keeps its channel select (it also has *Phone call*), now defaulting to the tab's channel instead of always e-mail.

## 4. What changes

### API (`services/ai-api/app/followups`), additive

* `models.py`: a closed `ChannelStateOut` = `{channel: "email" | "whatsapp", blocked: <closed word> | null}`. `LeadFollowupOut` gains `channels: list[ChannelStateOut]` and `default_channel`; its existing `channel` (the one shown) and `gate` (for that channel, plus the lead-level `stopped`) stay. `DueItemOut` gains `channels`, `default_channel`, `open_draft_channel`; its existing fields stay.
* `routes.py`: `GET /leads/{id}/followup?channel=` makes `channel` **optional**; absent means "resolve the default" (an explicit channel behaves exactly as now).
* `service.py`: `lead_followup` and `due_list` read the gate per channel; the default-channel rule; `public_gate` keeps `erased_key` out of every channel state. No new error code, no new route.
* The adapter, the builder, the request, the engine, the blocker: **untouched**. `followup_cadence` 1.0.0 stays pinned and unchanged.

### Web (`apps/web`)

* `lib/api/followups.ts` and `followup-text.ts`: the new types and strict parsers (an unknown channel or state is a contract error), fixtures; one new family of sentences ("Open on: E-mail, WhatsApp"; the blocked channel reuses the gate's own sentences, never the server's text).
* `followups/`: `due-view.tsx` (a row shows the channels and links to the default channel), `lead-followup-view.tsx` (tabs, the other-channel draft line), `create-draft-form.tsx` (a fixed channel), `touch-form.tsx` (a default channel), `followup-logic.ts` (helpers), the lead page (an optional channel).

### Database: **NO migration is needed.**

`public.followup_gate(lead, channel)`, `record_touch`, `create_followup_draft`, `approve_followup_draft`, `record_draft_sent` already take `email` / `whatsapp`; the templates are the same for both channels. The one assumption this rests on (a phone-only lead can go all the way through WhatsApp: touch, draft, approval, "I sent it") is **proved first, as the opening test of commit 1**, on the real stack. **If that test fails, the ticket stops and is reported** (a database gap would need a decision, not a quiet fix). *Not in this ticket, noted for later:* a single function `public.followup_channel_gates(p_lead_id uuid) returns jsonb` (same role proof as `followup_gate`) if two reads per candidate prove slow; per-channel wording would be a templates migration and the owner's/lawyer's decision.

## 5. Interaction with the rules already built

* **Gate-first (stop > block > engine), per channel.** The stop is lead-level: a stopped lead is out of the list and both tabs show only the stop line. A block is per channel: on a blocked tab the decision is `stop` with the gate's closed word (the engine is not asked); on an open tab the engine's lead-level answer is shown. The list's engine answer is the lead's, computed once.
* **Replay.** Unchanged: a draft request replays for the same id, tenant, lead and channel (4d); the same id for another channel stays the constant `conflict`. With a fixed channel per tab and a new form id per render, a person never re-sends one id for another channel.
* **Suppression keys.** E-mail reads the e-mail key and WhatsApp the phone key (the key kind is part of the gate). A phone number may be shared by two contacts; if one of them is suppressed, the other's **WhatsApp** is blocked (`key`) and their e-mail is not (an e-mail address cannot be shared: the API refuses a duplicate). The lead stays listed on its open channel.
* **SM220 reasons per channel.** `contact` and `erased` are contact-level (both channels blocked, so the lead is not listed); `consent` and `key` are per channel; `unkeyed` (SM221) is per key kind (an e-mail key may exist while the phone key does not). The client only ever sees the closed words; `erased_key` is `key`, held once more in `public_gate`, now for each channel state.
* **Touches on a phone call** still count for the cadence and are not a draft channel. A phone-only lead's **first** message is a person's, recorded as a WhatsApp touch under the WhatsApp gate; the cadence takes over after it, as for e-mail.

## 6. Commits (small), tests, rehearsal

Each commit: `make check` before it (Lane A), the owner's rhythm (a diff to `~/Desktop`, stop for review where the owner asks).

| # | Commit | Tests |
| --- | --- | --- |
| 1 | **API.** Channel states, the default-channel rule, the due list across channels; opens with the **spike test** (a phone-only lead through WhatsApp end to end, real stack) | unit (fake repository): a phone-only lead is listed; e-mail blocked and WhatsApp open is listed with both states; blocked on both is not; a stopped lead skips the second read; the four default-channel cases; `erased_key` never appears. Route: the additive shape, `channel` optional, Viewer 403, a bad channel 422. Real stack: phone-only lead, consent withdrawn on one channel, shared phone number, stop, erasure; the equivalence gate re-run unchanged |
| 2 | **Web data layer.** Types, parsers, fixtures, text, helpers | vitest: strict parsers (an unknown channel is a contract error), the sentences, the helpers; the existing 1,460 stay green |
| 3 | **Web screens.** Due-list rows, tabs, the other-channel draft line, fixed channel in the draft form, the touch form's default | vitest: the role matrix (a Viewer sees nothing), no "Send" control, no wording field, tabs are links to the right address, the draft form carries a fixed channel, the touch form defaults to the tab, a blocked tab hides "Ask for a draft", the checklist-pins test |
| 4 | **Rehearsal.** Driver and click checklist | below |
| 5 | **Mutation delta and docs.** Mutants for the new branches (the default-channel rule, the short-circuit, the per-channel reads, the open-draft line); ADR 0022 addendum; the hand-off item and the pre-pilot row closed; the stale statements fixed | `tools/mutation-followups` lists extended; the pass re-run for Python and web; survivors closed or documented |

**Rehearsal driver changes** (`tests/rehearsal/followups.py`, `make rehearse-followups` and `make rehearse-prepare-followups`):

* new synthetic leads: a **phone-only** lead (no e-mail, WhatsApp consent, a first touch recorded on WhatsApp) and a lead with **e-mail blocked and WhatsApp open** (e-mail consent withdrawn after its first touch); `make_lead` learns "no e-mail" and "consent per channel";
* new checks: the phone-only lead is in the due list with WhatsApp open; the e-mail-blocked lead is listed with e-mail blocked (`consent`) and WhatsApp the default; lead 10 (a shared number) shows WhatsApp blocked (`key`) and e-mail open; the default channel follows the rule; a phone-only lead goes through WhatsApp end to end (draft, a Sales refusal to approve, Admin approval, "I sent it") and a draft on the blocked channel is refused with the right reason; the "nothing could send" checks stay;
* the lead table, the counts and the due-list expectations of the click checklist are updated (`docs/rehearsal-followups-checklist.md`): a step per new behaviour (open the WhatsApp tab from the due row; the phone-only lead; the blocked tab; the draft open on the other channel), the WhatsApp "known and open" line removed; the checklist-pin test keeps every quoted sentence tied to the screens.

## 7. The suppression-key recording screen: bundle or separate?

**Recommendation: a separate ticket, scheduled right after this one** (both gate real use: the key screen before the first outreach, WhatsApp before Customer Zero). Reasons: different surface and permission (an Owner-only workspace screen calling `POST /suppression/backfill` with the authenticator app, versus follow-up reads and drafts), different risks (key custody, backfill batching and idempotency, the unkeyed count), a different acceptance (the Owner counts keys; here a person works a lead), and bundling would double the review surface of a ticket whose purpose is small and well-bounded. The only coupling is display: a WhatsApp tab for a contact whose phone is unkeyed already shows the honest `unkeyed` sentence, which names the missing screen.

## 8. Questions for the owner (with my recommended answer)

1. **Due-list shape:** one row per lead listing its channels (A), or one row per lead and channel (B)? *Recommend A.*
2. **Leads blocked on every channel:** keep them out of the list (as today), or show them in a collapsed "cannot be contacted" section with the reasons? *Recommend out of the list: the list is things to do; a blocked lead is visible on its own page.*
3. **Default channel:** the rule in section 3 (open draft, then the last outbound channel, then e-mail, then WhatsApp)? Or add a *preferred channel* per contact (a column and a field on the contact screen, a separate ticket)? *Recommend the rule now; the column only if the owner finds the rule wrong in daily use.*
4. **A draft open on one channel and the person wants the other:** keep the database's one-draft-per-touch rule and make them discard first, or later add a "discard and make a WhatsApp draft" button (two steps, not atomic)? *Recommend discard first for now.*
5. **Wording:** the same three closed templates for WhatsApp as for e-mail? Real WhatsApp wording is the owner's (and possibly a lawyer's) decision and would be a templates migration. *Recommend the same wording now, synthetic placeholders as today.*
6. **Phone calls:** record them as touches (already possible) but never as a draft channel? *Recommend yes.*
7. **Cost:** two gate reads per candidate lead (at most 60 reads for 30 leads) acceptable for v1? *Recommend yes; measure on the rehearsal workspace, and add the single combined read function only if the due page is slow.*
8. **Tab order and labels:** fixed order E-mail, WhatsApp; the labels E-mail and WhatsApp as today? *Recommend yes.*

## Not changed by this ticket

The cadence engine (pinned 1.0.0), the blocker, the request builder, the replay and gate-first rules, every migration, the templates, sending (nothing is added that sends), the suppression-key screen, a preferred-channel field, drafts for phone calls, languages other than English, and design (the plain screens stay plain; design v2 is its own ticket).

## Owner's decisions (2026-10-07)

Answers to section 8: 1 A (one row per lead); 2 leads blocked on every channel stay out of the list; 3 the default-channel rule as written, no preferred-channel column; 4 discard first; 5 the same wording for WhatsApp as for e-mail for now (synthetic); 6 yes, phone calls are touches only; 7 yes, two gate reads per candidate; 8 yes, tab order E-mail then WhatsApp.

Changes to the plan:

* **Definition of done:** the owner will NOT do the stopwatch click test. It is replaced by: the headless driver (`make rehearse-followups`) passes. The click checklist (`docs/rehearsal-followups-checklist.md`) stays in the repository and is kept true to the screens.
* **Testing rhythm:** per commit, `make check-fast` plus the tests of the files the commit touches (and the commit's new tests); a spike or a risky assumption runs on the real stack. The full `make check` runs once at the end of the ticket, from a clean `db-reset`; mutation passes run at the end too.
* **Pre-pilot rows:** "WhatsApp wording" (the templates are synthetic and identical to e-mail) and the due list's bound (its own small ticket right after this one: one read-only database function plus paging; reordering alone is not enough).
* **Empty `channels`:** a lead page whose `channels` list is empty is read as "not reported" (an older API): it shows only the loaded channel's gate and never claims that no channel is open.

## Definition of done

The headless driver (`make rehearse-followups`) passes; `make check` passes locally once at the end of the ticket, from a clean `db-reset`; the click checklist (with the new WhatsApp steps) stays in the repository and its quoted sentences are pinned to the screens; ADR 0022, the hand-off, the pre-pilot rows and `CLAUDE.md` say WhatsApp is first-class and what is still open; a short report names anything fixed on its own, with the single function and its copy test where a database function was touched (none is planned).
