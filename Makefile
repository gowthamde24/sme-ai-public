.PHONY: install lint typecheck test check check-fast db-start db-stop db-reset db-test test-integration bench-rls contracts seed-demo dev-web dev-api

WEB := apps/web
API := services/ai-api
PY  := $(API)/.venv/bin

install:
	cd $(WEB) && npm ci
	python3 -m venv $(API)/.venv
	$(PY)/pip install -q -e "$(API)[dev]"

lint:
	cd $(WEB) && npm run lint
	cd $(API) && .venv/bin/ruff check . ../../tests/integration ../../scripts/seed_demo.py

typecheck:
	cd $(WEB) && npm run typecheck
	cd $(WEB) && npx tsc --noEmit -p ../../packages/contracts/tsconfig.json
	cd $(API) && .venv/bin/mypy

test:
	cd $(WEB) && npm test
	cd $(API) && .venv/bin/pytest -q

# Inner loop: no Docker needed.
check-fast: lint typecheck test

# Definition of done. Needs Docker + the Supabase CLI (the DB isolation tests are the security gate).
check: check-fast db-test test-integration

# Local Supabase stack (Docker). Migrations in supabase/migrations are applied on start.
db-start:
	supabase start

db-stop:
	supabase stop

# Rebuild the local DB from migrations (drops all local data).
db-reset:
	supabase db reset

# pgTAP suite in supabase/tests/database (RLS isolation, roles, audit, catalog guards).
db-test:
	supabase test db

# Regenerate packages/contracts/{crm,evidence}.schema.json + .ts from the API models (a test fails if stale).
contracts:
	cd $(API) && .venv/bin/python ../../scripts/export-contracts.py

# RLS policy-cost benchmark (rolled back; local stack only). Compares the T002 per-row pattern
# with the shipped once-per-statement pattern. See ADR 0004. Override size: make bench-rls ARGS="-v tenants=1000"
bench-rls:
	psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -X $(ARGS) -f supabase/bench/rls_policy_cost.sql

# API + real local Supabase (GoTrue, PostgREST, Postgres): isolation end to end, private-schema
# exposure, concurrent last-owner race. Needs `make db-start`. Exports only the public URL and anon key.
test-integration:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration -q

# A clearly fictional business (company, contacts, products, lead, opportunity, evidence, claims) in a
# local workspace, built through the API (claims through PostgREST with the demo user's own JWT).
# Refuses to run against anything but a local stack. Needs `make db-start` and `make dev-api`.
seed-demo:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/seed_demo.py

dev-web:
	cd $(WEB) && npm run dev

dev-api:
	cd $(API) && .venv/bin/uvicorn app.main:app --reload --port 8000
