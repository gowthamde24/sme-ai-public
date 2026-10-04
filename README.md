# SME AI Revenue Engine

An AI workforce for SMEs. V1: lead discovery -> research -> qualification -> enquiry/RFQ -> quote -> follow-up -> order, with human approval at every risky step.

Start with `CLAUDE.md` (rules and working rhythm), then `docs/product.md` and `docs/architecture.md`.

## Layout

```
apps/web/            Next.js + TypeScript
services/ai-api/     FastAPI (Python)
packages/contracts/  shared schemas/types
docs/                product, architecture, agents, adr
tests/               integration, evals
```

## Quick start

Requirements: Node 20+ (22 recommended), Python 3.11+, Git.

```
cp .env.example .env
make install
make check      # lint + typecheck + test
make dev-api    # http://localhost:8000/health
make dev-web    # http://localhost:3000
```

## Status

T001 (bootstrap) is done. Next is T002 (tenant/auth/RLS). Nothing else starts until the security gate passes.
