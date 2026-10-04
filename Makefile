.PHONY: install lint typecheck test check check-fast db-start db-stop db-reset db-test dev-web dev-api

WEB := apps/web
API := services/ai-api
PY  := $(API)/.venv/bin

install:
	cd $(WEB) && npm ci
	python3 -m venv $(API)/.venv
	$(PY)/pip install -q -e "$(API)[dev]"

lint:
	cd $(WEB) && npm run lint
	cd $(API) && .venv/bin/ruff check .

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
# Integration tests join this target in the API milestone.
check: check-fast db-test

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

dev-web:
	cd $(WEB) && npm run dev

dev-api:
	cd $(API) && .venv/bin/uvicorn app.main:app --reload --port 8000
