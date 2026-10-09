# SME AI Revenue Engine

An AI workforce for SMEs. V1: lead discovery -> research -> qualification -> enquiry/RFQ -> quote -> follow-up -> order, with human approval at every risky step.

Agents: start with `AGENTS.md` and [parallel lanes](docs/lanes.md). The quick start below is owner-operated; agents follow the lane restrictions.

Start with `CLAUDE.md` (rules and working rhythm), then `docs/product.md` and `docs/architecture.md`.

## Layout

```
apps/web/            Next.js + TypeScript
services/ai-api/     FastAPI (Python)
packages/contracts/  shared schemas/types
docs/                product, architecture, agents, adr, pre-pilot-checklist
supabase/            migrations, pgTAP tests (RLS), local stack config
tests/               integration, evals
```

## Quick start

Requirements: Node 22.13.0 (pinned in `.nvmrc`; run `nvm install` to match CI), Python 3.11+, Git, Docker (or OrbStack/Colima) and the [Supabase CLI](https://supabase.com/docs/guides/local-development) (`brew install supabase/tap/supabase`).

```
make install
make db-start      # local Supabase stack (Postgres, Auth, PostgREST); applies supabase/migrations
make check         # lint + typecheck + unit + pgTAP + integration (needs the stack running)
make check-fast    # same without Docker: lint + typecheck + unit tests
```

Run the apps locally against the stack. `supabase status -o env` prints the public URL and anon key (never copy the service-role key anywhere; nothing here uses it). Each app reads its own env file, which is git-ignored:

```
# apps/web/.env.local
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY from supabase status>   # the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY is still accepted
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000

# services/ai-api/.env      (API_ENV=development fills in the rest from the local stack)
SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY from supabase status>   # the legacy SUPABASE_ANON_KEY is still accepted
```

```
make dev-api    # http://localhost:8000/health
                # agents are OFF unless you start it with:  AGENTS_ENABLED=true make dev-api
                # (the scripted fake model is for local development only; `make seed-demo` then runs one demo agent run)
make dev-web    # http://localhost:3000  ->  /login, then /app
```

See `.env.example` for every variable name. Outside development the API refuses to start unless all auth settings are present.

## Run the demo

The manual-price quote demo runs on your machine only, with invented data. Open three terminals in the repository (after `make install`):

```
make db-start           # 1. the local database and sign-in service (Docker must be running)
make dev-api-local      # 2. the API on :8000 (no .env file needed: the local public key is taken from `supabase status`)
make dev-web-local      # 3. the web app on :3000
make seed-demo-manual   # 4. (a fourth terminal) a workspace named DEMO: 12 item types, a quote policy, one enquiry
make demo-code          # prints the 6-digit second-factor code to type after the password
```

Open http://localhost:3000/login and sign in as `demo-owner@demo.example.test`; the password is the constant `DEMO_PASSWORD` in `scripts/seed_demo.py` (a local-only value). The seed prints the links to the item types page and the enquiry. The demo owner has exactly one workspace and always lands on Today, which shows a quote waiting for approval, a follow-up draft and an order step with money held. The Main agent (assistant) is switched off; to try it locally see `docs/runbooks/main-agent-local.md`. A code lasts about 30 seconds; run `make demo-code` again for a new one. These commands refuse to start unless the database is this machine, and `make db-reset` wipes the demo (run `make seed-demo-manual` again after it).

If it does not start: Next.js allows one `next dev` per folder, so stop an older `make dev-web` first (it prints the PID to stop); if a port is taken, use `make dev-api-local API_PORT=8001` and `make dev-web-local WEB_PORT=3001 API_PORT=8001`, and `SEED_API_URL=http://localhost:8001 make seed-demo-manual`. The links the seed prints always say port 3000.

## Status

T001 (bootstrap) is done. T002 (tenant/auth/RLS) is implemented across three milestones and awaiting final review; nothing else starts until it is approved. Open risks: `docs/pre-pilot-checklist.md`.
