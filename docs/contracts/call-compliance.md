# Calling compliance (the lawyer's written opinion of 25 Nov 2026; draft until the advocate has reviewed it)
Source: `reports/lawyer-opinion-actions.md`. Migrations 20261231992600 (window), 992610 (call compliance), 992620 (AI mention default, monitored line), 992630 (calls on when verified). Switches: API `OUTBOUND_REAL` (off).

## The call gate (`app/telephony/gate.py`), in order, for a REAL (live) outbound call
1. `live_not_confirmed`, then **`outbound_not_real`**: `OUTBOUND_REAL` is the global kill switch in front of every non-sandbox call; off until the telecom provider has answered. Sandbox calls never meet it.
2. approval, workspace pause, billing, **`complaints_pause`**: customers who asked us to stop (2 in 10 days) OR 5 complaints recorded for the workspace in 10 days (`POST /call-complaints`; a warning at 3).
3. A KNOWN person: a Consent Registrar id (no age), or a written/digital enquiry no older than **7 days** (an application, i.e. purpose `admission_followup`, 3 months = 92 days). Otherwise `enquiry_too_old` (an enquiry exists but is older) or `no_proof_of_request`. A list, a typed-in lead and "the business confirms consent" never count.
4. **`no_own_number`**: the workspace needs its OWN KYC-verified number (Model B). **`usage_not_accepted`**: the Owner must have accepted "how you will use this number" (stored, dated). The shared number stays limited to the owner's test numbers (the sandbox list).
5. the **calling window 10:00 to 21:00 IST** (`outside_window`; was 09:00), the workspace's own hours and holidays, limits, consent, STOP, DND, "the AI says it is an AI" when the greeting says so.
Plain words for every refusal are in `app/telephony/call_words.py`.

## Routes (Owner/Admin unless said; second factor where marked)
* `GET /v1/tenants/{t}/numbers/usage-ack` -> `{accepted, accepted_at, version}`. `POST` (Owner, 2nd factor) `{version}` -> 201 the same. The text of the statement is the existing "How you will use this number" step of the number flow (tick); the web calls the POST when that step is ticked, with the version label of the text it showed.
* `POST /v1/tenants/{t}/contacts/{contact_id}/registered-consent` (2nd factor) `{registrar_id}` (4 to 96 letters, digits `._#/-`) -> `{recorded: true}`. Stored as an ordinary granted phone consent whose evidence is `registrar:<id>`; the consent source of a contact is `digital_enquiry` (web form / e-mail reply), `registered_consent` (registrar id) or `business_statement` (anything else).
* `POST /v1/tenants/{t}/call-complaints` `{kind: to_business|telecom_provider|regulator, call_id?}` -> `{id, complaints_10d, warn (>= 3), paused (>= 5)}`.
* Staff: `GET /v1/admin/compliance/abandoned-calls?hours=24` -> `{answered, abandoned, rate_percent, alarm, by_business[], complaints[]}`; the staff alerts list gains `abandoned_calls` (above 3 percent of at least 20 answered outgoing calls in 24 hours) and `complaints_paused`.
  "Abandoned" = an outgoing call a person answered that ended without a human taking over (not voicemail, not a test or simulated call). By this definition an AI call that never hands over counts, as the opinion warns.

## The AI mention (default ON)
`say_ai_when_greeting` defaults to ON. `PUT /how-assistant-speaks` with `say_ai_when_greeting: false` needs `say_ai_undertaking: {accepted: true}` (Owner, 2nd factor; the server stores when and who and answers `say_ai_when_greeting.undertaking_accepted_at`); without a stored undertaking the save is `409 ai_undertaking_required` and an "off" already stored is read as ON. The same holds for a job's own "off". Calls without the mention are logged (`telephony ai_mention_off`, the call row keeps `ai_disclosed = false`). `POST /talk-training/ai-undertaking` (Owner, 2nd factor) records the acceptance on its own.

## Monitoring
A workspace whose Owner has switched on listening in / taking over (and the deployment allows it, `TAKEOVER_ALLOWED`) says "This call may be monitored." after the first sentence of the opening (English until a native reader approves the other languages). A person joining a live call is announced (`TAKEOVER_ANNOUNCE` now defaults to on). Who listened and when is the existing take-over audit (`public.call_takeover_event`). Recording stays off.
