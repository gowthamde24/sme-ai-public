# Contract: Enhance (C1 -> C2), 21 Nov 2026

`POST /v1/tenants/{t}/ai-assistant/enhance` (Owner, Admin; nothing is saved or sent). Body `{language: en|te|hi|kn|ta|ml|mr, text: 3..1500 chars}` (strict: no other field). Answer:

    {text, changes: [{from, to, rule}], applied: boolean, reason: string|null}

* `applied: true`: `text` is the rewrite; `changes` are the real edits (each `to` is in `text`; `rule` is one of the language's ids: te andi | garu | meeru | business_words | spoken_style | money_style | date_style; hi ji | aap | business_words | spoken_style | money_style | date_style; kn ri | neevu | business_words | spoken_style | money_style | date_style; en polite | plain | money_style | date_style; ta/ml/mr polite | money_style | date_style). The web may draw each change as a highlight (as Outpero does) and keep the rule id for a plain-word label.
* `applied: false`: `text` is the original, unchanged. `reason`: `nothing_to_change`, `unreadable`, `numbers_changed`, `link_added`, `promise_added`, `language_changed`, or `no_model` (the model did not answer in 30 s). The web says it plainly and leaves the field alone.
* Safety, in code (never the model): numbers, amounts and dates must be exactly the ones typed; no link, no promise or discount word, no change of language; the script is data (an instruction inside it is not followed); the script stays in its own script (native letters stay native, romanised stays romanised).
* Errors: 503 `enhance_unavailable` (no model wired), 429 `enhance_busy` (30 an hour per workspace), 403 for Sales/Viewer, 404 outside the workspace, 422 for a bad body.
* Eval cases (live, opt-in, a few rupees): `tests/evals/enhance/cases.jsonl`.
