# ADR 0122: one phone line, several providers (Exotel, Plivo, Vobiz) and the Plivo inbound connector

Status: **built for inbound (job 3 phase A, 10 Nov 2026), on staging only**. Phase B (outbound) and phase C (onboarding) follow. Nothing is deployed to production (none exists).

## Context
Exotel was too expensive (owner, 10 Nov 2026). Plivo's India region was proven by a throwaway test on real calls the same day (`docs/runbooks/plivo-inbound.md`: format, byte order, pacing, `clearAudio`, hang-up, cold start, billing). Vobiz documents the same
protocol and signing as Plivo. ADR 0120 already said the call path reads a number's provider and account from the number's row, never from a global setting.

## Decisions
1. **A provider is a wire protocol record** (`app/telephony/wire.py` `WireProtocol`): how a raw message is read (`parse`), how audio, a checkpoint and a clear are written, the rates and chunk rule. `PhoneLine` takes one (`proto=`; Exotel unless told otherwise)
   and no longer names a provider. The events that come in are one set of dataclasses (`Start`, `Media`, `Dtmf`, `Stop`, `Mark`), so the call session, the barge-in, the fade, the pacing and the transcript are the same for every provider.
   Exotel's behaviour and tests are unchanged. Vobiz becomes another record when its first real call is proven.
2. **Admission differs, the call does not.** Exotel asks us for a stream address and we confirm the call with Exotel's own record. Plivo asks us what to do with the call (`answer_url`) and SIGNS the request (V3, `app/telephony/plivo_signature.py`, checked against Plivo's own SDK
   vectors): the signature is the proof, so no lookup is needed. The answer decides everything the gate decides for Exotel (the line is a Plivo line of a workspace and answers inbound, the caller is on the sandbox list, the open lines); a call we do not take is answered with `<Hangup/>`.
   After admission BOTH providers run the same pipeline (`inbound_routes.run_admitted`). The WebSocket carries a per-call token (120 s, bound to the call id, derived from the Auth Token: no second secret) because Plivo does not sign the handshake; the answer request's admission is kept in memory
   for those 120 s and used once (one server answers a call; production needs affinity or a shared store before a second server).
3. **The phone line row says which provider and which account** (`public.phone_numbers.provider`, `account_ref` = a Secret Manager secret NAME, `external_ref` = the provider's account id; migration `20261231440000`). A call that arrives on a provider's address for another provider's number is refused.
   `phone_calls.provider` and `webhook_events.provider` accept `plivo` and `vobiz`.
4. **Facts that differ from Exotel and are built in:** Plivo's `start` has no from / to (they come from the signed answer request); there is no `stop` event (the socket closing is the end; closing ours ends the call about 1.3 s later); `clearAudio` needs the stream id and is acknowledged;
   audio is `audio/x-l16` 8 kHz little-endian; billing is a 30-second pulse.
5. **Secrets:** `sme-plivo-auth-token` is read by the one service that needs it (`sme-api-run`, a grant on that secret only). A subaccount's token (phase C) is a per-workspace secret named in the line's `account_ref`.
6. **No dependency added:** the signature is about 40 lines (Plivo's SDK would have been a new dependency for that alone).

## Legal status (read this)
The lawyer's answer on the three open items (switching off the AI mention in the greeting, an owner listening in on or taking over a live call, calls to business numbers found on public map listings) was **verbal on 10 Nov 2026 and is not confirmed in writing**. The safeguards stay
on regardless of any switch: the assistant never claims to be human and answers honestly when asked; outbound calls only 09:00 to 21:00 IST; DND respected; consent or an enquiry record kept; no recording; every switch change logged with who and when. Outbound calls to businesses stay off until the
140/160-series numbers and DLT registration exist and the answers are in writing.

## Consequences
- Plivo is a new sub-processor (live call audio and the two phone numbers, India region, no recording by us). The published list (`app/dpdp/data/subprocessors.json`) and the Privacy Policy need the entry; the proposed wording is in the job report and waits for the owner's OK.
- A cold start of the answer service (3.2 s measured) can make a caller give up: the staging API keeps one warm instance during tests (`API_MIN_INSTANCES=1`, about $44 a month, ADR 0072).
- Open before barge-in is relied on: whether Plivo plays audio sent within milliseconds after a `clearAudio` (the staging diagnostic), 16 kHz, burst sending, a caller hang-up during the stream.

## Phase B addendum (outbound, 10 Nov 2026)
`app/telephony/plivo_outbound.py` places a call: the gate first (a refusal is a refused call row with its closed word, nothing dialled), then the row (queued), then Plivo (`app/telephony/plivo_api.py`: answer and hangup addresses carry ids and closed words only), then ringing. The callee's pickup is a signed
request to `/v1/telephony/plivo/outbound-answer`, checked again against the sandbox list; the socket runs the same pipeline on the EXISTING row (`run_admitted(outbound=...)`). A call nobody answers is ended by Plivo's hangup callback. Only an owner's own phone on the sandbox list counts as consent, and only
while the deployment is a sandbox: `live` refuses (`no_consent`) until a consent path exists. `PlivoDialer` implements the outreach worker's `Dialer`; it is not wired. New database reads: `phone_line_for_tenant`, `phone_call_state` (migration `20261231450000`). New error code: `call_not_allowed`.
