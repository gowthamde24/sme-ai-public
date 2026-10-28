# 0116. The opening line, the "mention that I'm an AI assistant" switch, and the never-claim-to-be-human rule

Status: accepted (landing-v2 job, C1 part 1, 28 Oct 2026). Telephony is fake; nothing here dials.

## Context
The landing page promises that the business owner writes the first words the assistant says. Callers must also never be led to think they are talking to a person.

## Decisions
1. **Two tables, Owner-only writes** (`workspace.opening_lines`, `workspace.opening_settings`; functions `public.opening_get`, `opening_set_line`, `opening_set_mention`): the Owner's own line per language (en, te, hi, kn, ta, ml, mr, bn), per workspace or per campaign (a campaign row overrides the workspace row); a line is 10 to 300 characters and may hold the placeholders `{customer} {assistant} {business} {agent_role}` and nothing else in braces. Any member may read; a null text resets a line to the default. Row-level security is forced and no client holds table grants.
2. **The "mention that I'm an AI assistant" switch** is per workspace (default ON) or per campaign. OFF = the greeting is exactly the Owner's text. ON = the short disclosure is added unless the line already says it (`app/opening/render.py`). Every change of the switch is in the audit log (who, when, old and new value). The one-time notice text is returned to the screen as `disclosure_notice`.
3. **The never-claim-to-be-human rule is independent of the switch** (`app/opening/honesty.py`). It is always in the call and voice-note prompt (`app/opening/prompt.py`), whatever the opening line says. A deterministic detector recognises the question ("are you a robot / a real person?") in eight languages, spoken and romanised, and `guard_reply` puts the honest answer first when the customer asks, so the rule does not depend on a model's mood. An eval set (`app/opening/data/honesty_eval.json`: the question in every language plus statements that must NOT trigger it) runs in the unit tests.
4. **What the switch changes is only what the assistant volunteers.** With it OFF the assistant does not announce itself as an AI (job natural-voice, ADR 0117 adds that to the call style); asked sincerely it always answers truthfully.
5. **Preview**: an endpoint renders the line for a sample customer; the voice preview speaks the Owner's own line with the real assistant and business name.

## Consequences
- A live-model eval of the honesty rule was not run (costs money); it is the opt-in eval script. The detector is rule-based and can miss unusual phrasing; the prompt rule is the second layer.
- Marathi and Bengali lines are drafts for a native reader and are not yet in the product-wide language lists.
- pgTAP `131_dt_opening_line` covers the tables, the functions, roles, audit and the placeholder check.
