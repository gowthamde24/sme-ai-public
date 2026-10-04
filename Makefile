.PHONY: install lint typecheck test check check-fast db-start db-stop db-reset db-test test-integration dev-web dev-api

WEB := apps/web
API := services/ai-api
PY  := $(API)/.venv/bin

install:
	cd $(WEB) && npm ci
	python3 -m venv $(API)/.venv
	$(PY)/pip install -q -e "$(API)[dev]"

lint:
	cd $(WEB) && npm run lint
	cd $(API) && .venv/bin/ruff check . ../../tests/integration

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

# API + real local Supabase (GoTrue, PostgREST, Postgres): isolation end to end, private-schema
# exposure, concurrent last-owner race. Needs `make db-start`. Exports only the public URL and anon key.
test-integration:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration -q

dev-web:
	cd $(WEB) && npm run dev

dev-api:
	cd $(API) && .venv/bin/uvicorn app.main:app --reload --port 8000
