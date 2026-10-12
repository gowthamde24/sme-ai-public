.PHONY: dev-whatsapp-fake seed-demo-catalogue dev-worker-local install lint typecheck test test-packages check check-fast check-leftovers secret-scan restore-drill loadtest smoke-fetch db-start db-stop db-reset db-test test-integration eval eval-live assistant-smoke model-bakeoff stt-bakeoff bench-rls contracts seed-demo seed-demo-manual seed-demo-outbox seed-quote-data dev-api-local dev-api-groq dev-web-local demo-code rehearse-thin-slice rehearse-prepare-click rehearse-followups rehearse-prepare-followups dev-web dev-api e2e-local agent-db-up agent-db-down agent-db-reset agent-db-test agent-db-status stack-info owner-db-start

WEB := apps/web
API := services/ai-api
PY  := $(API)/.venv/bin

# Two separate local Supabase stacks (job BG, docs/runbooks/two-local-stacks.md). The OWNER's demo runs on the default stack (supabase/, project sme-ai, ports 543xx, API :8000, web :3000). Everything an
# AGENT runs defaults to the AGENT stack (stacks/sme-ai-agent, project sme-ai-agent, ports 544xx; API :8001, web :3001): reset, pgTAP, integration tests, evals, seeds, rehearsals. STACK=owner chooses the owner's
# stack on purpose, and its destructive actions (reset, stop, pgTAP, a clock pin) also need OWNER_OK=1; scripts/sb and tests/integration/conftest.py refuse them otherwise.
# The serving targets (dev-api-local, dev-web-local, dev-worker-local, demo-code, dev-api-groq) follow the port: the default :8000 is the owner's API, any other port is the agents'.
ifdef STACK
SERVE_STACK := $(STACK)
else
STACK := agent
SERVE_STACK = $(if $(filter 8000,$(API_PORT)),owner,agent)
endif
export SME_STACK := $(STACK)
SB := ./scripts/sb

install:
	cd $(WEB) && npm ci
	python3 -m venv $(API)/.venv
	$(PY)/pip install -q -e "$(API)[dev]"

lint:
	cd $(WEB) && npm run lint
	cd $(API) && .venv/bin/ruff check . ../../tests/integration ../../tests/rehearsal ../../scripts/seed_demo.py ../../scripts/seed_demo_manual.py ../../scripts/seed_demo_outbox.py ../../scripts/seed_demo_catalogue.py ../../scripts/local_confirm.py ../../scripts/demo_code.py ../../scripts/dev_worker_local.py ../../scripts/gen_match_key_fixture.py ../../scripts/smoke_fetch.py ../../scripts/stack_env.py ../../scripts/gen_agent_stack.py ../../scripts/fake_whatsapp_server.py ../../tools/mutation-followups

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

# Job CB (ADR 0082): fails when a tracked file holds the shape of a real credential (provider keys, private-key blocks, a service-role JWT, a long literal assigned to a secret-like name). Prints FILE:LINE and the kind, never the value.
secret-scan:
	python3 scripts/secret_scan.py

check-fast: check-leftovers secret-scan lint typecheck test test-packages

# Definition of done. Needs Docker + the Supabase CLI (the DB isolation tests are the security gate).
# db-reset first: audit rows of earlier integration runs are append-only, so a stale database could trip a pgTAP canary (T008 owner change I).
check: check-fast db-reset db-test test-integration eval

# Local Supabase stacks (Docker). Migrations in supabase/migrations are applied on start.
# db-start / db-stop are the OWNER's stack (the demo's), as before; db-stop needs OWNER_OK=1. Agents use agent-db-up / agent-db-down.
db-start owner-db-start:
	SME_STACK=owner $(SB) start

db-stop:
	SME_STACK=owner $(SB) stop

# The AGENT stack: its own project id, containers, volumes and ports (docs/runbooks/two-local-stacks.md). Its migrations and pgTAP files are copies of supabase/'s, made by scripts/sb before each command.
agent-db-up:
	SME_STACK=agent $(SB) start

agent-db-down:
	SME_STACK=agent $(SB) stop

agent-db-reset:
	SME_STACK=agent $(SB) db reset

agent-db-test:
	SME_STACK=agent $(SB) test db

# Which stack is each thing on, and is it running? (prints no key)
agent-db-status stack-info:
	@. ./scripts/stack.sh; echo "this shell's stack: $$SME_STACK (project $$SME_PROJECT_ID, API :$$SME_API_PORT, database :$$SME_DB_PORT)"; for c in supabase_db_sme-ai supabase_db_sme-ai-agent; do if docker inspect -f '{{.State.Running}}' $$c >/dev/null 2>&1; then echo "  $$c: running"; else echo "  $$c: not running"; fi; done

# Rebuild the local DB from migrations (drops all local data). The AGENT stack by default; STACK=owner needs OWNER_OK=1.
db-reset:
	$(SB) db reset

# pgTAP suite in supabase/tests/database (RLS isolation, roles, audit, catalog guards). The AGENT stack by default; STACK=owner needs OWNER_OK=1.
db-test:
	$(SB) test db

# Regenerate packages/contracts/{crm,evidence,leads}.schema.json + .ts from the API models (a test fails if stale).
contracts:
	cd $(API) && .venv/bin/python ../../scripts/export-contracts.py

# RLS policy-cost benchmark (rolled back; local stack only). Compares the T002 per-row pattern
# with the shipped once-per-statement pattern. See ADR 0004. Override size: make bench-rls ARGS="-v tenants=1000"
bench-rls:
	@. ./scripts/stack.sh; psql "postgresql://postgres:postgres@127.0.0.1:$$SME_DB_PORT/postgres" -X $(ARGS) -f supabase/bench/rls_policy_cost.sql

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

# OPT-IN, NEVER part of make check (job AJ): the FIRST LIVE RUN of the Main agent. Five fixed questions on the seeded demo workspace through the REAL Anthropic adapter, PASS/FAIL per
# question, at most 30 rupees (3000 paise) for the whole command, the daily cap stays on (and the run stops if the demo workspace is over its AI allowance and a light model is configured). The key comes from the environment only; without it the command prints one line and stops.
# Needs `make db-start`, `make seed-demo` and `make seed-demo-manual`. See docs/runbooks/main-agent-live-smoke.md.
assistant-smoke:
	cd $(API) && ../../scripts/with-local-demo-env.sh .venv/bin/python ../../tests/integration/assistant_smoke.py

# OPT-IN, NEVER part of make check (job AK / K3): which model is best for the Main agent, MEASURED. The 30 assistant eval questions plus 10 code-mixed Telugu/Kannada ones, asked of each named model on the
# seeded demo through the REAL provider adapters; one table row per model (pass rate, Telugu quality, price refusal, injection refusal, median latency, paise per answer). At most 30 rupees per model; keys from
# the environment only (a model without its key is skipped). MODELS="provider:model:input_price:output_price ..." (a model on your own Mac: openai_compat:llama3.2:3b:0:0 with LLM_BASE_URL=http://localhost:11434/v1, no key, labelled a plumbing check) ; LIMIT=n asks only the first n questions (a spread). See docs/runbooks/model-bakeoff.md.
# Job BQ (ADR 0079) adds 36 SHOP TASKS (nine things an owner really asks, in English, Telugu, Hindi and Kannada: SUITE=shop|classic|all, default all = 76 questions), scored for tool correctness (read from the run's
# recorded steps) and rule-following; the providers groq (the hosted FREE tier: GROQ_API_KEY, openai/gpt-oss-120b, price 0:0) and fake (the scripted stand-in: no key, a plumbing check); ONE spending limit for the
# whole command, Rs 100, unless CONFIRM_SPEND=1 (then SPEND_CAP_RS, at most Rs 500); and the report is written OUTSIDE the repository, ~/Desktop/v2-overnight/model-bakeoff.md (REPORT=...), with a sheet for a native
# reader next to it. SUITE, REPORT, CONFIRM_SPEND and SPEND_CAP_RS are read from the environment or the make line. See docs/runbooks/model-bakeoff.md.
model-bakeoff:
	cd $(API) && MODELS="$(MODELS)" LIMIT="$(LIMIT)" ../../scripts/with-local-demo-env.sh .venv/bin/python ../../tests/integration/model_bakeoff.py

# OPT-IN, NEVER part of make check (job AK / K3, extended by job BD): which speech engine hears your shop talk best. DIR is a folder of .wav/.m4a samples OUTSIDE the repository (default ~/Desktop/voice-samples; refused if
# inside), named <language>-<nn>.m4a (te, hi, kn, en) with <name>.truth.txt (what was said) and optionally <name>.txt (Chrome's result). Engines (each only by its own variables): Sarvam (SARVAM_API_KEY), Bhashini
# (BHASHINI_API_KEY + BHASHINI_ASR_SERVICE_ID), Google (GOOGLE_API_KEY), an AI4Bharat model (AI4BHARAT_STT_URL), Chrome. Word and character error, time and price per language; text-to-speech samples to listen to. The report is
# written to ~/Desktop/v2-overnight/voice-bakeoff.md (REPORT=...), never into the repository. See docs/runbooks/voice-local.md.
stt-bakeoff:
	cd $(API) && DIR="$(DIR)" ../../scripts/with-local-demo-env.sh .venv/bin/python ../../tests/integration/stt_bakeoff.py

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

# Job AY (ADR 0069), LOCAL ONLY: twelve invented sarees in the demo workspace, each with one to three GENERATED placeholder pictures (a colour and a pattern: no real product photo), uploaded through the
# API into the demo's private bucket in the local Storage. Idempotent. Needs `make db-start` (Storage is on in supabase/config.toml), `make dev-api-local` and `make seed-demo-manual`.
# Job BR (ADR 0076), LOCAL ONLY: a stand-in for WhatsApp's Cloud API and for Meta's webhook on 127.0.0.1:8791. It sends nothing to anyone. See docs/runbooks/whatsapp-local.md.
# Needs the API running with WHATSAPP_APP_SECRET=local-app-secret (same value as APP_SECRET below). Override: make dev-whatsapp-fake WEBHOOK_URL=http://127.0.0.1:8001/v1/webhooks/whatsapp
WEBHOOK_URL ?= http://127.0.0.1:8001/v1/webhooks/whatsapp
APP_SECRET ?= local-app-secret
dev-whatsapp-fake:
	cd $(API) && .venv/bin/python ../../scripts/fake_whatsapp_server.py --port 8791 --webhook-url $(WEBHOOK_URL) --app-secret $(APP_SECRET) --auto-status

seed-demo-catalogue:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/seed_demo_catalogue.py

# Job AT (ADR 0066), LOCAL ONLY: turns the outbox kill switch on in the local database, then makes a few outbox rows (one that goes by itself, two that wait for approval, one blocked) and one call
# request in the demo workspace, through the API as the demo owner. Nothing is sent to anyone: the only channel is a stand-in inside the API. Needs `make db-start`, `make dev-api-local` and
# `make seed-demo-manual`. The web's Today must know the new kinds of waiting item first (see docs/runbooks/outbox-local.md).
seed-demo-outbox:
	./scripts/dev-enable-outbox.sh on
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/seed_demo_outbox.py

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
	cd $(API) && .venv/bin/uvicorn app.main:app --reload --no-server-header --port 8000

# The local demo, one command each (see "Run the demo" in README.md). They take the LOCAL stack's URL and PUBLIC key from `supabase status` (never the secret or
# service-role key), map them to the names each app needs, print nothing, write no file, and refuse unless the Supabase URL is this machine. dev-api and dev-web are unchanged.
# Ports are 8000 and 3000; if another program already uses one, pick others: make dev-api-local API_PORT=8001, make dev-web-local WEB_PORT=3001 API_PORT=8001.
API_PORT ?= 8000
WEB_PORT ?= 3000

dev-api-local:
	cd $(API) && SME_STACK=$(SERVE_STACK) ../../scripts/with-local-demo-env.sh .venv/bin/uvicorn app.main:app --no-server-header --port $(API_PORT)

# OPT-IN (job AN): the local API with the Main agent on a hosted FREE-tier model, Groq openai/gpt-oss-120b (LLM_MODEL=... to choose another). Reads the API key HIDDEN (or takes LLM_API_KEY if it is
# already set), checks it against Groq's models endpoint and refuses an empty or refused key, records the model's price at the minimum, switches the assistant on for the demo workspace and starts the API on API_PORT with AGENTS_ENABLED=true. Local stack and synthetic data only.
# Needs `make db-start` and `make seed-demo-manual`. See docs/runbooks/main-agent-hosted-free.md.
dev-api-groq:
	SME_STACK=$(SERVE_STACK) API_PORT=$(API_PORT) ./scripts/dev-api-hosted-free.sh

# Job AW (ADR 0068): the scheduler worker, one process, local stack only. It releases messages held for the morning, queues visit reminders and (if the business asks) marks missed visits. It signs in
# as its own account, which the first run creates and registers (see scripts/dev_worker_local.py); it acts only while the global outbox switch is on AND the business has automatic sending on, and the only
# channel is the local fake. Ctrl-C stops it. `make dev-worker-local ARGS=--once` runs a single tick. See docs/runbooks/scheduler-local.md.
dev-worker-local:
	cd $(API) && SME_STACK=$(SERVE_STACK) ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/dev_worker_local.py $(ARGS)

dev-web-local:
	cd $(WEB) && SME_STACK=$(SERVE_STACK) LOCAL_DEMO_API_URL=http://localhost:$(API_PORT) ../../scripts/with-local-demo-env.sh npm run dev -- --port $(WEB_PORT)

# Prints the current 6-digit second-factor code of the local demo owner (a local demo code; the local database container only).
demo-code:
	@cd $(API) && SME_STACK=$(SERVE_STACK) ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/demo_code.py

# Job BE: the REAL-STACK end-to-end run. Starts your own API (:8002) and web (:3002) against the local Supabase stack (with Storage), drives the real web with a real browser (sign-up, sign-in with the authenticator,
# Today, Outbox, Settings, Visits, the saree Catalogue with a real photo upload, Ask), prints PASS/FAIL per step, stops what it started and removes its throwaway workspace. Local only, invented data. Opt-in: needs Docker,
# `make db-start`, the API's virtualenv and a browser; it refuses to start while an integration or pgTAP session is using the database. Never uses :3000, :8000 or :8001. See docs/runbooks/e2e-real-stack.md.
e2e-local:
	./scripts/e2e-local.sh

# Job CB (ADR 0082), OPT-IN, never in make check. Hardening and operations tools.
#   make restore-drill            the PLAN for a hosted backup/restore drill (touches nothing); DRILL=local runs a REAL drill on the AGENT stack's database (dump, restore into a scratch database,
#                                 compare every table's row count and supabase/hosted/verify.sql, time the restore): run `make agent-db-reset` first for a clean database. docs/runbooks/hardening.md
#   make loadtest SHOPS=50        N shops live a typical day at once against the local stack (the API on :8001, `AGENTS_ENABLED=true make dev-api-local API_PORT=8001`); prints latency and error tables;
#                                 exit 1 when the p95 or the error rate passes the limit. Synthetic data only; clean up with `make agent-db-reset`.
restore-drill:
	@if [ "$(DRILL)" = "local" ]; then python3 scripts/restore_drill.py --local --report "$${REPORT:-/dev/stdout}"; else python3 scripts/restore_drill.py --dry-run; fi

loadtest:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/loadtest.py --shops "$${SHOPS:-50}" --duration "$${DURATION:-60}" $(if $(REPORT),--report "$(REPORT)",) $(LOADTEST_ARGS)
