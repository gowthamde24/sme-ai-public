# My assistant: status, Go live, Pause (C1 -> C2, 13 Nov 2026)

`GET /v1/tenants/{t}/assistant/status` (any member) -> `{ "state": "not_live" | "in_training" | "live", "can_go_live": bool, "missing": ["business_name", "phone_number"], "using_defaults": ["voice", "rules"] }`.
`POST /v1/tenants/{t}/assistant/go-live` and `POST .../assistant/pause` (Owner, no second factor) -> the same object. Going live without what is missing: 409 `assistant_not_ready` with `missing` in the error.

- **Required to go live (owner, 13 Nov):** a business name of its own (the placeholder "My business" does not count) and a connected phone number (a number the platform answers on for the workspace, or an active WhatsApp account). Nothing else; training is optional.
- `state`: `live` = went live and nothing required has since gone; `in_training` = not live, but a voice (Settings > AI assistant) or Talk training rules were saved; `not_live` = neither.
- `using_defaults`: `voice` while the assistant settings were never saved, `rules` while Talk training was never saved. Both run on working defaults.
- Every go-live and pause is in the audit log. **Status of the effect:** the state is recorded now (database `workspace.assistant_live`); making the phone line and the automatic replies honour a PAUSE is the next step, tracked in the master list (J3).
