# Runbook: the Main agent on a hosted FREE model (Groq), on your Mac

Job AN. Local stack, synthetic demo data, **no money**. The assistant answers through Groq's free tier (`llama-3.3-70b-versatile`) instead of the scripted development model. Nothing here deploys anything; `make check` never runs it.

**What leaves your machine:** the question you type and the demo records the assistant reads to answer it (the invented DEMO business) go to Groq. Free tiers may log prompts or use them to improve their models, so use **only** the demo workspace. Never a real customer, number or price. The adapter refuses to start outside development.

## Your commands (zsh, in the repository)

One time, to get the demo business (skip if you already have it):

```
make db-start
make dev-api-local                 # leave it running in this tab
make seed-demo-manual              # in a second tab, then stop the first tab with Ctrl-C
```

Every time you want the assistant on a real model:

```
make dev-api-groq
```

It asks `Paste the API key (hidden, it is not shown or saved):`. Paste your Groq key and press Enter; nothing appears on screen. The key lives only in that terminal's environment until you press Ctrl-C. (If `LLM_API_KEY` is already set in the shell, it uses that and does not ask.)

In another tab, as before: `make dev-web-local`, then open http://localhost:3000/login (`demo-owner@demo.example.test`, `make demo-code` for the second-factor code) and use **Ask**.

Another port: `make dev-api-groq API_PORT=8001` (and `make dev-web-local WEB_PORT=3001 API_PORT=8001`). Another Groq model: `LLM_MODEL=<id> make dev-api-groq`.

## What `make dev-api-groq` does for you

1. Refuses unless the address is exactly one of the three allowed ones and the model id is plain text.
2. Reads the key hidden. It never prints it, writes it to a file, reads a `.env` file or uses a service-role key.
3. Records the model's price in the **local** database at the minimum (1 micro per million tokens; an existing row for the model is kept). **No SQL for you to type.** Without a price row every call would be refused with `model_not_configured`.
4. Switches the Main agent on for the demo workspace (`app.operator_enable_assistant('demo-synthetic-sme')`). If the workspace is not there it stops and says `make seed-demo`.
5. Starts the API with `AGENTS_ENABLED=true`, `LLM_PROVIDER=openai_compat`, `LLM_BASE_URL=https://api.groq.com/openai/v1`.

## The three allowed hosts (and nothing else)

| Service | `LLM_BASE_URL` (exactly) | Note |
|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | what `make dev-api-groq` uses |
| Cerebras | `https://api.cerebras.ai/v1` | `LLM_BASE_URL=https://api.cerebras.ai/v1 LLM_MODEL=<id> make dev-api-groq` |
| OpenRouter | `https://openrouter.ai/api/v1` | the model id **must end in `:free`**; OpenRouter bills every other model |

Any other remote address stops the API at start (a key is never sent anywhere else). A model on this machine (Ollama) keeps working as before and needs no key.

## What you will see when it is busy or not set up

* **"The AI service is busy, try again in a minute."**: the free tier answered 429 (too many requests). Wait a minute. It is not a spending limit and does not touch your allowance.
* **`model_not_configured`**: the model has no price row (you started the API some other way, or on a database that was reset). Run `make dev-api-groq` again; it records the price.
* The spending-limit message (`ai_paused_until`) still means the workspace's own allowance is used up. It is no longer shown for the two cases above.

## Codes for the web (Claude 2)

The assistant stream ends with an `error` event `{type, code, message}`. Two new codes, neither shown as a spending limit:

| `code` | When | Fixed English `message` |
|---|---|---|
| `model_busy` | the provider answered HTTP 429 | The AI service is busy, try again in a minute. |
| `model_not_configured` | the model has no price row in the database | The AI model is not set up yet. Ask the person who looks after this system to finish setting it up. |

Starting a message when the model has no price is refused with HTTP 503 `model_not_configured` (body `{code, message}`). `ai_paused_until` is unchanged and is sent only for a real allowance or cap. The web's closed code list (`ERROR_CODES` in `ask-stream.ts`) needs the two new codes and its own sentence for each; an unknown code already falls back to the generic failure.

## Answers do not name tools

The system prompt forbids naming a tool, function or internal field, and the server checks every answer: one that contains a tool name or an internal field name (for example `find_price`, `refused_call`) is not shown. A plain sentence in the owner's language is shown instead, and the log records only THAT it happened (language and kind), never the answer. `make eval` has eight cases for it.

## Stop it

Ctrl-C in the tab that runs `make dev-api-groq`. That ends the process and forgets the key. To switch the assistant off for every business: `update public.platform_flags set enabled = false where key = 'assistant_enabled';` (see `main-agent-local.md`).
