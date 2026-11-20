# Contract: "Say 'AI assistant' when greeting" (C1 -> C2), 21 Nov 2026 (owner decision 20 Nov; built after the voices PR, staging Wed 25 Nov)

The owner's rule: the greeting of a call or WhatsApp message follows a SETTING (default OFF: name only, "Namaste, I'm Priya from Sri Sai Homes"). Separately, and NOT a setting: whenever a customer asks whether they are talking to a person, a robot or an AI (any language), the assistant answers truthfully that it is the business's AI assistant and never claims to be human. The owner-facing assistant (ABOUT_STACK19) is unchanged. The web shows no switch for the honest answer; it may say it in one plain line under the setting.

## The business setting
`GET/PUT /v1/tenants/{t}/how-assistant-speaks` (Owner, Admin write; the same document as `tone` and `background`) gains:

    say_ai_when_greeting: {value: boolean, saved: boolean}      # value false until the owner turns it on; saved = the owner chose
    GET  -> {..., "say_ai_when_greeting": {"value": false, "saved": false}}
    PUT  {"say_ai_when_greeting": true | false}                 # null = back to the default (false)

## The per-job override
In `GET /jobs/{id}` (full S2) `settings.more` has one setting:

    {key: "say_ai_when_greeting", type: "choice", value: "business" | "on" | "off", options: ["business", "on", "off"], area: "more"}

`business` (default) follows the business setting; `on` / `off` override it for that job. Change it with `PATCH /jobs/{id} {"settings": {"say_ai_when_greeting": "on"}}`. Until the full S2 exists, the web shows the business setting only.

## What the API does
* Greeting: calls (inbound and outbound) and WhatsApp openings add "I'm the AI assistant of {business}" only when the resolved value is true (job override, else business setting, else false). Previews and the test call use the same resolution as real calls (`resolve_sound`).
* The honest answer: fixed, in te / hi / kn / en (and the other call languages), the same in both settings; evals check both.
* Errors: a non-boolean value is `422 invalid_value`; Owner and Admin only (403 otherwise).

## Text we append ourselves (21 Nov 2026, migration 20261231987500)
The AI sentence ("This message is from the business's AI assistant.") that we add to a person's first message follows the same resolved setting: campaign messages, trip updates, the assistant's first reply and the campaign preview (`preview.disclosure` is `""` when it is OFF, so the approval screen's quote matches what is sent). The STOP wording is never touched: it is part of the approved template or the consent ask ("Reply STOP any time to stop."). A template already approved by Meta keeps its approved text.
