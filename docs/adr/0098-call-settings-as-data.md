# ADR 0098: call settings as data (job DP, part 4)

Status: built on branch `api/dp-call-settings` (night run 26 Oct 2026); telephony itself does not exist yet.

## Context
The AI assistant will phone customers. How it behaves on the phone (how often it retries, what it does with a voicemail or a phone menu, how long it waits in silence, when it may call, who takes over for which topic) must be the owner's to set and ours to change without a release. Settings > AI assistant (job DM) already holds the assistant's name, voice, language, discount limit and its calling days and hours.

## Decision
1. **One settings document per workspace plus one override per campaign** (`public.call_settings`: `campaign_id` null = the workspace). The override is a **partial** document: a field that is absent or null is inherited. `effective` (the workspace's settings with the override on top) is what a dialer will read; the merge is a pure function (`app/callsettings/service.py: resolve`).
2. **The database validates the whole document** (`app.call_settings_validate`): every key, every type (a switch is true or false, not "yes"), every range and step, every list limit, clean text, no unknown keys. The API's models say the same; a pgTAP test pins each boundary.
3. **Calling hours are not duplicated.** `hours: null` means "follow Settings > AI assistant"; a workspace or a campaign may set its own. `holidays` (days it never calls) are the business's, not a campaign's.
4. **What belongs to the business is not overridable per campaign:** holidays, hand-over rules and the allowed purposes.
5. **Hand-over rules are personal data** (a team member's name and phone number): they live in their own table (`call_handover_rules`), are in the erasure registry (tenant scope and the identifier sweep), and are never in the settings document, so a list of settings never carries a phone number. Only the Owner and Admin read them.
6. **The school rule is data too:** an education workspace's `allowed_purposes` is held to admission follow-up, visit reminders and event reminders (no sales calls, none about dues or fees), by the database and by the API (`locked`, 422 `locked_for_business_type`). Its defaults: fewer retries, one call per guardian per week, no contact memory.
7. **Defaults per business type are data** (`app/callsettings/data/call_settings.json`), the first key being the default for a pack that has none. The numbers are sensible starting points, to be tuned with real calls.
8. **Only the Owner (second factor) saves**; Owner and Admin read. Sales and Viewers see nothing here.

## Consequences
- Nothing here places a call. When telephony is built the dialer reads `effective` and enforces the weekly limit, the hours, the holidays and the auto-pause; those need no new settings.
- The plan's allowance on concurrent calls (if any) is applied by the dialer as the lower of the two; the settings only say what the owner wants.
- Wording of the option labels is an English draft awaiting native review like every other line.
