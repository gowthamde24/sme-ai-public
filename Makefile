.PHONY: install lint typecheck test test-packages check check-fast check-leftovers smoke-fetch db-start db-stop db-reset db-test test-integration eval eval-live bench-rls contracts seed-demo dev-web dev-api

WEB := apps/web
API := services/ai-api
PY  := $(API)/.venv/bin

install:
	cd $(WEB) && npm ci
	python3 -m venv $(API)/.venv
	$(PY)/pip install -q -e "$(API)[dev]"

lint:
	cd $(WEB) && npm run lint
	cd $(API) && .venv/bin/ruff check . ../../tests/integration ../../scripts/seed_demo.py ../../scripts/gen_match_key_fixture.py ../../scripts/smoke_fetch.py

typecheck:
	cd $(WEB) && npm run typecheck
	cd $(WEB) && npx tsc --noEmit -p ../../packages/contracts/tsconfig.json
	cd $(API) && .venv/bin/mypy

test:
	cd $(WEB) && npm test
	cd $(API) && .venv/bin/pytest -q

# Pure package tests: stdlib unittest, no database or network.
test-packages:
	python3 scripts/test-packages.py

# Inner loop: no Docker needed.
# Fails when a tracked file is an editor / patch / `sed -i` leftover (*-E, *.orig, *.rej, *.bak, *~).
check-leftovers:
	./scripts/check-no-leftovers.sh

check-fast: check-leftovers lint typecheck test test-packages

# Definition of done. Needs Docker + the Supabase CLI (the DB isolation tests are the security gate).
check: check-fast db-test test-integration eval

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

# Regenerate packages/contracts/{crm,evidence,leads}.schema.json + .ts from the API models (a test fails if stale).
contracts:
	cd $(API) && .venv/bin/python ../../scripts/export-contracts.py

# RLS policy-cost benchmark (rolled back; local stack only). Compares the T002 per-row pattern
# with the shipped once-per-statement pattern. See ADR 0004. Override size: make bench-rls ARGS="-v tenants=1000"
bench-rls:
	psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -X $(ARGS) -f supabase/bench/rls_policy_cost.sql

# API + real local Supabase (GoTrue, PostgREST, Postgres): isolation end to end, private-schema
# exposure, concurrent last-owner race. Needs `make db-start`. Exports only the public URL and anon key.
test-integration:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration -q --ignore=../../tests/integration/test_agent_evals.py

# T006 agent containment evals: scripted models that OBEY every injection, run against the real local stack; the hard gate is
# measured from the database afterwards (tests/evals/, tests/integration/agent_eval.py). FakeProvider only: no key, no network.
eval:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration/test_agent_evals.py -q

# OPT-IN, NEVER part of make check: the live-capable cases against the REAL model, pass rates vs tests/evals/thresholds.json.
# Refuses unless the real adapter's own gates are satisfied (provider, model, key, prices, spend-cap confirmation).
eval-live:
	cd $(API) && .venv/bin/python ../../tests/integration/eval_live_preflight.py
	cd $(API) && EVAL_LIVE=1 ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration/test_agent_evals.py -q -s -k test_live_pass_rates

# OPT-IN, NEVER part of make check: fetches https://example.com/ and https://example.org/ through the REAL guarded page
# fetcher (T007 M1) and prints status, bytes, content type and sanitised-text length only. No model, no key, no cost.
smoke-fetch:
	cd $(API) && .venv/bin/python ../../scripts/smoke_fetch.py

# A clearly fictional business (company, contacts, products, lead, opportunity, evidence, claims) in a
# local workspace, built through the API (claims through PostgREST with the demo user's own JWT).
# Refuses to run against anything but a local stack. Needs `make db-start` and `make dev-api`.
#
# The last two steps are the T006 agent walkthrough, LOCAL ONLY: the operator switches for the DEMO workspace, then one selftest
# run under the scripted fake model. The run needs the API started with AGENTS_ENABLED=true:
#     AGENTS_ENABLED=true make dev-api
seed-demo:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/seed_demo.py
	./scripts/dev-enable-selftest.sh demo-synthetic-sme
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/seed_demo.py --agents

dev-web:
	cd $(WEB) && npm run dev

# Agents are OFF unless you start the API with AGENTS_ENABLED=true (and, locally, the scripted fake model):
#     AGENTS_ENABLED=true make dev-api
dev-api:
	cd $(API) && .venv/bin/uvicorn app.main:app --reload --port 8000
