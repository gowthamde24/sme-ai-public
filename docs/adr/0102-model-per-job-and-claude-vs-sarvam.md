# ADR 0102: the model is a setting per AI job; Claude versus Sarvam compared (night 3, part 2)

Status: built on branch `ai/provider-per-job` (night run 27 Oct 2026). **No behaviour changes:** every job is `claude` unless an environment variable says otherwise, and nothing sets one.

## Decision
1. **One setting per job:** `AI_JOB_ASK`, `AI_JOB_RESEARCH`, `AI_JOB_OUTCOME_CLASSIFY`, `AI_JOB_FOLLOWUP_PLAN`, `AI_JOB_CALL_TURN`, `AI_JOB_WHATSAPP_REPLY`. Values `claude` (the default: the main model exactly as `LLM_PROVIDER` configures it; the light model and the routing table are untouched) or `sarvam`. A wrong word stops the process at start. An environment setting, not a workspace one: it is an operator's cost and quality decision, and it needs no table.
2. **The Sarvam adapter already existed** (`ChatCompletionsClient` with `sarvam_config`, behind the `LlmClient` interface, tool calling in the OpenAI shape, the key in `api-subscription-key`). docs.sarvam.ai lists tool calling and JSON schema output for `sarvam-105b` on `/v1/chat/completions`; the adapter uses the tool route (the way every model result is taken here). It is now chosen per job by `app.agent_runs.wiring.build_job_llms` (needs `SARVAM_API_KEY` and `LLM_SPEND_CAP_CONFIRMED`, like every hosted model). The AI ledger prices it with a new row in `agent_model_prices` (migration 20261201090100: Rs 15 in, Rs 60 out per million tokens, `on conflict do nothing`).
3. **Which jobs refuse `sarvam`** (the setting stops the process at start and says why; the registry is `app/agents/llm/jobs.py`):
   - `ask`: a many-tool, multi-turn loop with citations; not compared on Sarvam.
   - `research`: has no live model path yet (fixtures only); not compared.
   - `outcome_classify`: classified by a reviewed word list, not a model; nothing to switch.
   - `followup_plan`: planned by rules in code; nothing to switch.
   - `call_turn` and `whatsapp_reply` accept it. `whatsapp_reply` is the lead message draft (`app/assistant/draft.py`, one call, a structured reply, no tools) and reads its model through `AgentsRuntime.llm_for("whatsapp_reply")`. `call_turn` has no consumer until telephony exists; it reads the same setting when it does.
4. **`make model-compare`** (opt-in, never CI): 40 synthetic conversations (te 12, hi 12, kn 6, ta 5, ml 5; saree follow-up, cement price, school admission, "not interested", "are you a robot?", a child's fees), each under both jobs and both models, with the rules checked by code (replied through the tool, language script, numbers only from the facts, a listed fact given, AI disclosure when asked, no pushing after a no, a child's fees refused and handed to the school office, length). Hard cap 150,000 Sarvam tokens (worst case of a call counted before it is made, kept across runs), Claude Haiku only. Results: `~/Desktop/stack19-jobs/model-compare/` (`results.md`, a blind `side-by-side.html`, `raw.json`, `usage.json`).
5. **The owner decides any switch** after a native speaker has read the side-by-side page; the rules cannot judge wording. Claude stays the default.

## Findings (details in results.md)
- Rules: Claude Haiku passes all of them on the 80 pairs; Sarvam 105B passes all but one reply (a call turn that came back as plain text instead of the tool call). Both disclose being an AI when asked, both refuse a child's fees and hand over to the school office.
- Cost: about Rs 33 per 1,000 turns on Claude Haiku and about Rs 70 on Sarvam 105B (it writes twice the tokens, most of them reasoning).
- Latency: median 3.1 s on Claude and 6.5 s on Sarvam (95th percentile 4.5 s and 11.3 s), whole calls without streaming. Too slow for a spoken turn on either, worse on Sarvam.
- Output limits: Kannada on Claude and Sarvam's reasoning both ran into 900 and 1,500 output tokens; the affected calls were repeated with larger limits.

## Consequences
- Switching a job is an environment change and a restart, reversible at once.
- Streaming and a non-reasoning setting are the things to try before Sarvam is used for a live call turn.
