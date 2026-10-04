# SME AI Revenue Engine

An AI workforce for SMEs. V1: lead discovery -> research -> qualification -> enquiry/RFQ -> quote -> follow-up -> order, with human approval at every risky step.

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
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000

# services/ai-api/.env      (API_ENV=development fills in the rest from the local stack)
SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
```

```
make dev-api    # http://localhost:8000/health
                # agents are OFF unless you start it with:  AGENTS_ENABLED=true make dev-api
                # (the scripted fake model is for local development only; `make seed-demo` then runs one demo agent run)
make dev-web    # http://localhost:3000  ->  /login, then /app
```

See `.env.example` for every variable name. Outside development the API refuses to start unless all auth settings are present.

## Status

T001 (bootstrap) is done. T002 (tenant/auth/RLS) is implemented across three milestones and awaiting final review; nothing else starts until it is approved. Open risks: `docs/pre-pilot-checklist.md`.
