# A switch per helper: the API contract (C1 -> C2; sidebar v2 "My AI team", 5 Nov 2026)

Base `/v1/tenants/{tenant_id}`. The helper keys are the same as `GET /agents/status`.

| Method and path | Who | Answer |
|---|---|---|
| `GET /agents/switches` | Owner, Admin | `[AgentSwitchOut]`, one per helper, in this order: main, researcher, requirement_analyst, then lead_finder, quote_writer, followup_desk, order_desk |
| `PUT /agents/{agent}/switch` | Owner | body `{enabled: true \| false}` (strict) -> `AgentSwitchOut`. `404` unknown helper, `409 not_switchable` for a helper without a switch of its own, `422` a body that is not exactly that |

`AgentSwitchOut`: `{ agent, enabled, can_switch, reason_locked: null | "platform" | "workspace_off" | "not_built", done_today: int | null }`
- **Real switches: `main` (the assistant), `researcher`, `requirement_analyst`.** A helper switched off **cannot start a run**: the database checks it where every run starts (with the platform's switch, the workspace's AI-helpers switch and the agent type's own flag). No decorative switch.
- `can_switch: false` with `reason_locked`:
  - `platform`: the platform has it off;
  - `workspace_off`: the workspace's AI helpers are switched off (Settings);
  - `not_built`: lead_finder, quote_writer, followup_desk, order_desk are features, not agent runs, and have no switch of their own yet: draw the status, no toggle.
- `done_today`: runs that finished well today (India day), for the three real helpers; `null` for the others (use `GET /agents/status`'s `last_event` for their line).
- No second factor: switching a helper only turns work off or on.
