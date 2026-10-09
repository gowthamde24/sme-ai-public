# Runbook: the Main agent on the local stack

The assistant is OFF at every layer. Nothing here touches a hosted project, sends anything or needs a key.

## Switch it on for the demo business (local only)
1. `make db-start`, then `make seed-demo-manual` (the DEMO business, with one waiting quote, one follow-up draft and one order step).
2. In the local database: `select app.operator_enable_assistant('demo-synthetic-sme');` (psql to `127.0.0.1:54322` as the local `postgres` user). It sets the platform flag, allows the business and turns on its
   switch. 
3. Start the API with agents enabled: `AGENTS_ENABLED=true make dev-api-local` (the scripted development model; nothing leaves the machine); the real model needs the key and the opt-in gates of ADR 0013.

## Switch it off
- Fastest: `update public.platform_flags set enabled = false where key = 'assistant_enabled';` (every business at once; a running reply is refused at its next step and save).
- One business: `update public.tenant_agent_settings set enabled = false where tenant_id = '<id>';`.
- `GET /agents/status` then shows `main` as `switched_off`.

## Try it
`POST /v1/tenants/{id}/assistant/messages` with `{"message_id": "<uuid>", "text": "What is waiting for me?"}` and the owner's bearer token (SSE). `GET .../assistant/conversations/{id}` reads it back.

## What to check after any change
`make eval` (30 assistant cases among the containment evals), pgTAP 74, and `tests/integration/test_assistant_*.py`.
