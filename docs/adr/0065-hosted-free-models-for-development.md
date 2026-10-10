# ADR 0065: hosted free-tier models for development

Status: accepted (job AN, 2026-10-10). Extends ADR 0017 (b) and ADR 0064.

## Context
The scripted model proves the plumbing, a model on the owner's Mac (Ollama) is slow and weak, and a paid model needs the owner's approval, a provider-side cap and a spend-cap confirmation (ADR 0017). The owner wants to see the assistant answer with a capable model at no cost, on synthetic data.

## Decision
1. The `openai_compat` adapter accepts a **remote** `LLM_BASE_URL` only from an exact allow-list: `https://api.groq.com/openai/v1`, `https://api.cerebras.ai/v1`, `https://openrouter.ai/api/v1` (one trailing slash is tolerated; no other host, scheme, port, path or credential). Each requires `LLM_API_KEY` (environment only, never logged, never in a repr; the HTTP client does not follow redirects). OpenRouter is accepted only for a model id ending in `:free`.
2. Development only: outside `API_ENV=development` the process refuses to start. A free tier belongs to a developer's machine and synthetic data; its near-zero recorded price must never stand in for a real spend cap, and the free services' data terms are not reviewed for customer data (the real-data gate stays closed).
3. A free-tier model is recorded at the smallest price the database allows (1 micro per million tokens, as for a local model), so every call still counts for at least one micro and the daily cap, the per-run budget and the allowances still apply. No spend-cap confirmation is asked for (nothing is billed). `make dev-api-groq` records the price row in the local database itself.
4. A model with no usable price row is **not** a spending limit. The reservation refusal carries its reason; `no_price` becomes `ModelNotConfigured` (a subclass of `CostCapReached`, so every existing handler still stops the run) and the assistant reports it as `model_not_configured`. A provider 429 is reported as `model_busy` ("The AI service is busy, try again in a minute."). The database's error-code list is unchanged: both are recorded as `model_failed`, and the client gets the precise code.

## Consequences
* No new dependency, no migration, no change to the cap functions. Provider specifics stay in `app/agents/llm/openai_compat.py` (rule 9).
* Free tiers are rate limited; `model_busy` is expected and is retried by the person, not by the code (one request per call, no retries).
* Using a hosted free model for anything beyond synthetic data needs a new ADR and the owner's written approval (ADR 0017 b).
