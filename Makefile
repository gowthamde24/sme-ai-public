.PHONY: install lint typecheck test test-packages check check-fast check-leftovers smoke-fetch db-start db-stop db-reset db-test test-integration eval eval-live bench-rls contracts seed-demo seed-demo-manual seed-quote-data dev-api-local dev-web-local demo-code rehearse-thin-slice rehearse-prepare-click rehearse-followups rehearse-prepare-followups dev-web dev-api

WEB := apps/web
API := services/ai-api
PY  := $(API)/.venv/bin

install:
	cd $(WEB) && npm ci
	python3 -m venv $(API)/.venv
	$(PY)/pip install -q -e "$(API)[dev]"

lint:
	cd $(WEB) && npm run lint
	cd $(API) && .venv/bin/ruff check . ../../tests/integration ../../tests/rehearsal ../../scripts/seed_demo.py ../../scripts/seed_demo_manual.py ../../scripts/local_confirm.py ../../scripts/demo_code.py ../../scripts/gen_match_key_fixture.py ../../scripts/smoke_fetch.py ../../tools/mutation-followups

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
# db-reset first: audit rows of earlier integration runs are append-only, so a stale database could trip a pgTAP canary (T008 owner change I).
check: check-fast db-reset db-test test-integration eval

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
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration -q --ignore=../../tests/integration/test_agent_evals.py --ignore=../../tests/integration/test_research_evals.py --ignore=../../tests/integration/test_research_golden.py --ignore=../../tests/integration/test_requirement_evals.py --ignore=../../tests/integration/test_requirement_golden.py --ignore=../../tests/integration/test_assistant_evals.py

# T006 agent containment evals: scripted models that OBEY every injection, run against the real local stack; the hard gate is
# measured from the database afterwards (tests/evals/, tests/integration/agent_eval.py). FakeProvider only: no key, no network.
# T007 adds the Research Agent's web-injection cases (tests/evals/research/, tests/integration/research_eval.py): synthetic fixture
# sites only, no network.
eval:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration/test_agent_evals.py ../../tests/integration/test_research_evals.py -q
	# T007 M3: the Research Agent golden set (20 synthetic businesses). Prints the report; FAILS on any wrong claim that is accepted.
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration/test_research_golden.py -q -s
	# T008: the Requirement Agent's injection cases (tests/evals/requirement/cases.jsonl; scripted models that obey every injection) and its golden
	# set (20 synthetic enquiries). Prints the report; FAILS on any `stated` field that is wrong or unasked for, on any containment invariant, and on a changed report.
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration/test_requirement_evals.py -q
	# job AG: the Main agent's 30 cases (10 English, 10 Telugu, 10 mixed) on the real stack with a scripted model that obeys every injection: answers carry real sources and no
	# invented amount, a price is never set, nothing is sent or approved, one business never reads another (tests/integration/assistant_eval.py).
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration/test_assistant_evals.py -q
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration/test_requirement_golden.py -q -s

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

# Manual-price quote demo (slice 4b), LOCAL ONLY: a workspace named DEMO with twelve invented item types, a published quote policy and one invented enquiry, through the API as the demo owner.
# Same sign-in as seed-demo (no service-role key, no new secret); refuses any URL that is not this machine; idempotent. Needs `make db-start` and `make dev-api`. Wipe: `make db-reset`.
seed-demo-manual:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/seed_demo_manual.py

# T009: SYNTHETIC quote reference data (six invented products, a price list, a quote policy, a mapper config) for a LOCAL workspace:
#     make seed-quote-data TENANT=demo-synthetic-sme
# Runs the operator function inside the local database container; refuses any URL that is not this machine; idempotent. Real prices, rates
# and terms are the owner's and the accountant's and never come from this target.
seed-quote-data:
	@test -n "$(TENANT)" || { echo "usage: make seed-quote-data TENANT=<workspace slug>"; exit 2; }
	cd $(API) && .venv/bin/python seeds/seed_quote_reference_data.py --tenant-slug "$(TENANT)"

# Rehearsal step 3 (docs/plans/thin-slice-rehearsal.md): the whole slice through the API as Owner, Admin, Sales and Viewer (and a second workspace), from the synthetic CSV to
# closed_paid, then run a second time on the same database (it must change nothing). Local stack only, synthetic data, no model, nothing sent. Run `make db-reset` first for a
# fresh database. Writes rehearsal-report.md at the repository root (git-ignored). Opt-in: not part of make check.
rehearse-thin-slice:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../tests/rehearsal/drive.py

# The same rehearsal up to APPROVED QUOTES only (no order is started): the owner then clicks the orders by hand in the browser (docs/rehearsal-click-checklist.md). Run `make db-reset` first.
rehearse-prepare-click:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../tests/rehearsal/drive.py --until=quotes

# T010 part 2 (commit 4): the follow-up rehearsal on the local stack. Every run makes a NEW synthetic workspace (no db-reset needed). The first runs the whole journey headless and asserts every step
# and refusal (writes rehearsal-followups-report.md, git-ignored); the second only prepares the workspace for the owner to click through (docs/rehearsal-followups-checklist.md). Opt-in: not part of make check.
rehearse-followups:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../tests/rehearsal/followups.py

rehearse-prepare-followups:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../tests/rehearsal/followups.py --prepare-only

dev-web:
	cd $(WEB) && npm run dev

# Agents are OFF unless you start the API with AGENTS_ENABLED=true (and, locally, the scripted fake model):
#     AGENTS_ENABLED=true make dev-api
dev-api:
	cd $(API) && .venv/bin/uvicorn app.main:app --reload --port 8000

# The local demo, one command each (see "Run the demo" in README.md). They take the LOCAL stack's URL and PUBLIC key from `supabase status` (never the secret or
# service-role key), map them to the names each app needs, print nothing, write no file, and refuse unless the Supabase URL is this machine. dev-api and dev-web are unchanged.
# Ports are 8000 and 3000; if another program already uses one, pick others: make dev-api-local API_PORT=8001, make dev-web-local WEB_PORT=3001 API_PORT=8001.
API_PORT ?= 8000
WEB_PORT ?= 3000

dev-api-local:
	cd $(API) && ../../scripts/with-local-demo-env.sh .venv/bin/uvicorn app.main:app --port $(API_PORT)

dev-web-local:
	cd $(WEB) && LOCAL_DEMO_API_URL=http://localhost:$(API_PORT) ../../scripts/with-local-demo-env.sh npm run dev -- --port $(WEB_PORT)

# Prints the current 6-digit second-factor code of the local demo owner (a local demo code; the local database container only).
demo-code:
	@cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/demo_code.py
