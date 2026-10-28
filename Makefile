.PHONY: test-integration-run eval-run e2e-new-owner seed-demo-school docker-up deploy-staging staging-status rollback-staging staging-latest staging-smoke staging-backup staging-drill packs-check site-packs site-shots pack-migration new-pack pack-shots perf perf-budget container-smoke hosted-smoke visual visual-update dev-whatsapp-fake seed-demo-catalogue dev-worker-local install lint typecheck test test-packages check check-fast check-leftovers secret-scan restore-drill loadtest smoke-fetch db-start db-stop db-reset db-test test-integration eval eval-live assistant-smoke model-bakeoff stt-bakeoff bench-rls contracts seed-demo seed-demo-manual seed-demo-outbox seed-quote-data dev-api-local dev-api-groq dev-web-local demo-code rehearse-thin-slice rehearse-prepare-click rehearse-followups rehearse-prepare-followups dev-web dev-api e2e-local e2e-packs agent-db-up agent-db-down agent-db-reset agent-db-test agent-db-status stack-info owner-db-start

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
	cd $(API) && .venv/bin/ruff check . ../../tests/integration ../../tests/rehearsal ../../scripts/seed_demo.py ../../scripts/seed_demo_manual.py ../../scripts/seed_demo_outbox.py ../../scripts/seed_demo_catalogue.py ../../scripts/local_confirm.py ../../scripts/demo_code.py ../../scripts/dev_worker_local.py ../../scripts/prepare_channel_agent.py ../../scripts/whatsapp_test_local.py ../../scripts/gen_match_key_fixture.py ../../scripts/smoke_fetch.py ../../scripts/stack_env.py ../../scripts/gen_agent_stack.py ../../scripts/packs_check.py ../../scripts/pack_migration.py ../../scripts/plans_check.py ../../scripts/plans_migration.py ../../scripts/new_pack.py ../../scripts/fake_whatsapp_server.py ../../tools/mutation-followups

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

# Job CK (blueprint section 13): the business-type packs are DATA in packages/packs/<id>/pack.json. `packs-check` validates every pack against packages/packs/pack.schema.json, the closed lists (modules.json,
# labels.json), the rules (the default pack keeps every module that exists today, custom fields, example data) and that NO string literal in the API or the web's non-test code is a pack id; it also fails
# when a pack or module is not in a migration yet (`make pack-migration` writes it). `new-pack ID=<id>` starts a new business type as a draft. See docs/runbooks/add-a-business-type.md.
packs-check:
	$(PY)/python scripts/packs_check.py
	$(PY)/python scripts/pack_migration.py --check
	node $(WEB)/scripts/site-packs.mjs --check   # job CM: the public site's copy of the landing blocks is fresh (`make site-packs` writes it)

.PHONY: usage-report plans-check plans-migration
# Job DI: the plans catalogue is DATA in packages/plans/plans.json (prices null until the owner sets them). `plans-check` validates it against plans.schema.json, its rules, that NO plan id is a string literal in code,
# and that its version is in a migration (`make plans-migration` writes it). A synced version is never edited: raise `version`. ADR 0092.
plans-check:
	$(PY)/python scripts/plans_check.py
	$(PY)/python scripts/plans_migration.py --check

plans-migration:
	$(PY)/python scripts/plans_migration.py

# Job DI: what the staging workspaces used (AI ledger, business WhatsApp messages, call minutes) and what each plan would cost us at low / typical / heavy use; READ-ONLY, synthetic data, a markdown table for the owner
# (the cost model is scripts/usage_assumptions.json: everything not measured is an ASSUMPTION and printed as one). Usage: make usage-report OUT=~/Desktop/v2-overnight/usage-report.md
usage-report:
	python3 -I scripts/usage_report.py --source staging --i-know-this-reads-staging --project-ref uiallwgywitryxatcqxf --days 14 --out "$(or $(OUT),usage-report.md)"

site-packs:
	node $(WEB)/scripts/site-packs.mjs

pack-migration:
	$(PY)/python scripts/pack_migration.py

new-pack:
	@test -n "$(ID)" || { echo "usage: make new-pack ID=<id>   (lower case, for example clinics)"; exit 2; }
	$(PY)/python scripts/new_pack.py "$(ID)"

check-fast: check-leftovers secret-scan packs-check plans-check lint typecheck test test-packages

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
	SME_STACK=agent ./scripts/db-lock.sh $(SB) db reset

agent-db-test:
	SME_STACK=agent ./scripts/db-lock.sh $(SB) test db

# Which stack is each thing on, and is it running? (prints no key)
agent-db-status stack-info:
	@. ./scripts/stack.sh; echo "this shell's stack: $$SME_STACK (project $$SME_PROJECT_ID, API :$$SME_API_PORT, database :$$SME_DB_PORT)"; for c in supabase_db_sme-ai supabase_db_sme-ai-agent; do if docker inspect -f '{{.State.Running}}' $$c >/dev/null 2>&1; then echo "  $$c: running"; else echo "  $$c: not running"; fi; done

# Rebuild the local DB from migrations (drops all local data). The AGENT stack by default; STACK=owner needs OWNER_OK=1.
db-reset:
	./scripts/db-lock.sh $(SB) db reset

# pgTAP suite in supabase/tests/database (RLS isolation, roles, audit, catalog guards). The AGENT stack by default; STACK=owner needs OWNER_OK=1.
db-test:
	./scripts/db-lock.sh $(SB) test db

# Regenerate packages/contracts/{crm,evidence,leads}.schema.json + .ts from the API models (a test fails if stale).
contracts:
	cd $(API) && .venv/bin/python ../../scripts/export-contracts.py

# RLS policy-cost benchmark (rolled back; local stack only). Compares the T002 per-row pattern
# with the shipped once-per-statement pattern. See ADR 0004. Override size: make bench-rls ARGS="-v tenants=1000"
bench-rls:
	@. ./scripts/stack.sh; psql "postgresql://postgres:postgres@127.0.0.1:$$SME_DB_PORT/postgres" -X $(ARGS) -f supabase/bench/rls_policy_cost.sql

# API + real local Supabase (GoTrue, PostgREST, Postgres): isolation end to end, private-schema
# exposure, concurrent last-owner race. Needs `make db-start`. Exports only the public URL and anon key.
test-integration-run:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration -q --ignore=../../tests/integration/test_agent_evals.py --ignore=../../tests/integration/test_research_evals.py --ignore=../../tests/integration/test_research_golden.py --ignore=../../tests/integration/test_requirement_evals.py --ignore=../../tests/integration/test_requirement_golden.py --ignore=../../tests/integration/test_assistant_evals.py

# T006 agent containment evals: scripted models that OBEY every injection, run against the real local stack; the hard gate is
# measured from the database afterwards (tests/evals/, tests/integration/agent_eval.py). FakeProvider only: no key, no network.
# T007 adds the Research Agent's web-injection cases (tests/evals/research/, tests/integration/research_eval.py): synthetic fixture
# sites only, no network.
# One session at a time on the local database (scripts/db-lock.sh, docs/runbooks/two-local-stacks.md): the public target takes the lock and runs the -run target inside it.
test-integration:
	./scripts/db-lock.sh $(MAKE) --no-print-directory test-integration-run

eval:
	./scripts/db-lock.sh $(MAKE) --no-print-directory eval-run

eval-run:
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

# OPT-IN, NEVER part of make check (night 3, ADR 0102): Claude Haiku against Sarvam 105B on 40 synthetic conversations (te 12, hi 12, kn 6, ta 5, ml 5) for the call_turn and whatsapp_reply jobs: rules checked by code,
# latency, tokens and cost per 1,000 turns, and a blind side-by-side page for a native speaker. Writes ~/Desktop/stack19-jobs/model-compare/{results.md,side-by-side.html,raw.json,usage.json}. HARD CAP 150,000 Sarvam
# tokens in total (kept in usage.json), Claude Haiku only, finished calls are cached. Keys are read from Secret Manager at run time, never printed. DRY=1 only counts; LIMIT=n runs the first n conversations.
.PHONY: model-compare
model-compare:
	$(API)/.venv/bin/python scripts/model_compare.py $(if $(DRY),--dry-run,) $(if $(LIMIT),--limit $(LIMIT),)

# OPT-IN, NEVER part of make check (job AK / K3, extended by job BD): which speech engine hears your shop talk best. DIR is a folder of .wav/.m4a samples OUTSIDE the repository (default ~/Desktop/voice-samples; refused if
# inside), named <language>-<nn>.m4a (te, hi, kn, en) with <name>.truth.txt (what was said) and optionally <name>.txt (Chrome's result). Engines (each only by its own variables): Sarvam (SARVAM_API_KEY), Bhashini
# (BHASHINI_API_KEY + BHASHINI_ASR_SERVICE_ID), Google (GOOGLE_API_KEY), an AI4Bharat model (AI4BHARAT_STT_URL), Chrome. Word and character error, time and price per language; text-to-speech samples to listen to. The report is
# written to ~/Desktop/v2-overnight/voice-bakeoff.md (REPORT=...), never into the repository. See docs/runbooks/voice-local.md.
stt-bakeoff:
	cd $(API) && DIR="$(DIR)" ../../scripts/with-local-demo-env.sh .venv/bin/python ../../tests/integration/stt_bakeoff.py

# OPT-IN, NEVER part of make check (night 3, ADR 0101): listening samples with the REAL Sarvam voice: the call opening and two follow-ups in en, te, hi, kn, ta, ml (3 voices, 2 styles) into
# ~/Desktop/stack19-jobs/voice-samples/ with an index.html. HARD CAP 9,000 characters in total (kept in usage.json). The key is read from Secret Manager at run time, never printed. DRY=1 only counts.
# voice-stt-check transcribes two of those clips per language back (cap 180 seconds of audio in total) and writes voice-samples/stt-report.md.
.PHONY: voice-samples voice-stt-check
voice-samples:
	$(API)/.venv/bin/python scripts/voice_samples.py $(if $(DRY),--dry-run,)

voice-stt-check:
	$(API)/.venv/bin/python scripts/voice_samples.py --stt $(if $(DRY),--dry-run,)

# job DS: the same lines as people really say them (everyday spoken style), 3,000 characters at most (kept in voice-samples/spoken/usage.json), before-vs-now page
.PHONY: voice-samples-spoken
voice-samples-spoken:
	$(API)/.venv/bin/python scripts/voice_samples_spoken.py $(if $(DRY),--dry-run,)

# job DS: Claude Haiku only (no Sarvam credit): the comparison conversations answered with and without the register block; 600,000 tokens at most
.PHONY: register-ab
register-ab:
	$(API)/.venv/bin/python scripts/register_ab.py $(if $(DRY),--dry-run,)

# job DR B1: the 30 task-planning instructions (six languages) planned by the real planner with Claude Haiku ONLY; 500,000 tokens at most
.PHONY: tasks-eval
tasks-eval:
	$(API)/.venv/bin/python scripts/tasks_eval.py $(if $(DRY),--dry-run,)

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
# Job DG (scripts/seed_demo_school.py, scripts/demo_data.py): the local twin of the hosted seed's extra demo data: a construction product (visible, with a generated placeholder picture) and a school (students, guardians with
# FAKE +00 phones, fees with dues), each in its own workspace. Local stack only, idempotent, never overwrites. Needs the stack and `make dev-api-local`.
seed-demo-school:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/seed_demo_school.py

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

# OPT-IN (job CD), LOCAL stack and synthetic data only: the local API with the REAL WhatsApp Cloud API adapter, for Meta's free TEST number. Reads the access token, the app secret and a verify phrase HIDDEN (read -rs),
# checks the token with Meta, prepares the channel account in the local database and starts the API on API_PORT (default 8000 = the owner's stack). The fake channel stays the default everywhere else.
# See docs/runbooks/whatsapp-test-number.md.
dev-api-whatsapp:
	SME_STACK=$(SERVE_STACK) API_PORT=$(API_PORT) ./scripts/dev-api-whatsapp.sh

# OPT-IN (job CD), local only: connect / inbox / reply / status for the test number, as the Owner of its own local workspace "WA Test (local)". ARGS="connect --waba-id ... --phone-number-id ...", ARGS=inbox,
# ARGS="reply --lead <id> --text '...'", ARGS=status. Needs `make dev-api-whatsapp` running on API_PORT. See docs/runbooks/whatsapp-test-number.md.
whatsapp-test:
	cd $(API) && SME_STACK=$(SERVE_STACK) SEED_API_URL=http://localhost:$(API_PORT) ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/whatsapp_test_local.py $(ARGS)

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

# Job CL, OPT-IN, never in make check or CI: the business-type sign-up on the real stack (the same start-up, clean-up and guards as e2e-local): the two-step sign-up by e-mail for each business type, the setup by itself, Today in its words,
# the module guard, the checklist, example data, the second step, custom fields; and the Google path as far as it can go without the owner's own Google account (docs/runbooks/social-sign-up.md). The two ids are PUBLIC placeholders so the
# API offers the buttons; the local Auth server has the providers off, which is what the run checks.
# Night run C2 (jobs CO, CQ, CS, CU), OPT-IN, never in make check or CI: the screens of the construction, campaign and education jobs through a real browser on the real stack (the same start-up, clean-up and guards as e2e-local),
# for a school, a builder and the saree shop, and pictures of every pack's screens (light and dark, laptop and 390 px phone) into E2E_SHOTS (default ~/Desktop/v2-overnight/shots-night).
e2e-c2:
	E2E_SCRIPT=night-c2-flows.mjs ./scripts/e2e-local.sh

# The new-owner walkthrough (job DT, OPT-IN, never in make check or CI; same start-up, clean-up and guards): a Google-style new person, sign-up with "Other", the set-up (kind and name only), Today with "Finish setting up", the assistant by typing,
# a profile picture, the business name and phone, sign out and in. Needs the local Supabase stack with Storage (make agent-db-up).
e2e-new-owner:
	E2E_SCRIPT=new-owner.mjs ./scripts/e2e-local.sh

e2e-packs:
	E2E_SCRIPT=cl-signup.mjs AUTH_GOOGLE_CLIENT_ID=local-public-placeholder AUTH_FACEBOOK_APP_ID=local-public-placeholder ./scripts/e2e-local.sh

# Speed (job CF, e2e/perf/README.md). `make perf` is OPT-IN, never in make check: it builds the web app against the visual tests' stand-in backend and measures LCP, FCP, TBT, INP, CLS and the bytes of six screens in a throttled
# phone-sized Chromium (slow 4G, 4x slower CPU); ports 54999 and 3016 only, nothing of the owner's. ARGS="--no-build --only landing,today --runs 5 --lang te --api-delay 100 --out result.json".
# `make perf-budget` is the cheap guard (about a second, after `npm run build`): the gzip JavaScript of every page route against scripts/budget.json; CI runs it after the build.
perf:
	node e2e/perf/measure.mjs $(ARGS)

perf-budget:
	cd $(WEB) && npm run audit:route-js

# The visual tests (job BX, e2e/visual/README.md): pictures of Today, Visits, Outbox, Catalogue, a lead page, Settings and the landing page at 360 px and on a desktop, light and dark, English and Telugu, compared with the baselines of this
# system. They run on an invented stand-in backend (no database, no keys, no Docker, nothing of the owner's): ports 54999 and 3014 only. `make visual` builds the web app once and compares (exit 1 if a picture changed; the changed
# pictures and their diffs go to e2e/visual/out/). `make visual-update` writes the baselines of this system after a change you meant to make. Add ARGS="--no-build --only today,lead" to reuse the last build or pick screens.
visual:
	node e2e/visual/run.mjs $(ARGS)

visual-update:
	node e2e/visual/run.mjs --update $(ARGS)

# Job CM: pictures of the public website (home, the three business types, pricing, how it works, security, contact, help; English, and Telugu/Hindi/Kannada for a few), light and dark, laptop and 390 px phone, from the real web
# app with no backend (the public pages need none) and a made-up WhatsApp number for the chat forms; it also checks the calculator, the language switch and the menu. OPT-IN, never in make check. Port 3016.
#   make site-shots ARGS="--no-build --out /some/folder"
site-shots:
	node e2e/cm-shots.mjs $(ARGS)

# Job CL: pictures of the three business types (sign-up steps, Today, the phone's bar, Customers, Settings -> Fields, Start, Fees, Office, the 403 page), light and dark, laptop and 390 px phone, on the same invented
# backend; it also checks the menu of each business type and that a part a business type does not have answers 403 (typed address and a move inside the app). OPT-IN, never in make check. Ports 54999 and 3016.
#   make pack-shots ARGS="--no-build --only today,guard --out /some/folder"
pack-shots:
	node e2e/cl-shots.mjs $(ARGS)

# Job CB (ADR 0082), OPT-IN, never in make check. Hardening and operations tools.
#   make restore-drill            the PLAN for a hosted backup/restore drill (touches nothing); DRILL=local runs a REAL drill on the AGENT stack's database (dump, restore into a scratch database,
#                                 compare every table's row count and supabase/hosted/verify.sql, time the restore): run `make agent-db-reset` first for a clean database. docs/runbooks/hardening.md
#   make loadtest SHOPS=50        N shops live a typical day at once against the local stack (the API on :8001, `AGENTS_ENABLED=true make dev-api-local API_PORT=8001`); prints latency and error tables;
#                                 exit 1 when the p95 or the error rate passes the limit. Synthetic data only; clean up with `make agent-db-reset`.
restore-drill:
	@if [ "$(DRILL)" = "local" ]; then python3 scripts/restore_drill.py --local --report "$${REPORT:-/dev/stdout}"; else python3 scripts/restore_drill.py --dry-run; fi

loadtest:
	cd $(API) && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/loadtest.py --shops "$${SHOPS:-50}" --duration "$${DURATION:-60}" $(if $(REPORT),--report "$(REPORT)",) $(LOADTEST_ARGS)

# Job CE (ADR 0072), OPT-IN, never in make check. Hosting readiness.
#   make container-smoke          builds deploy/Dockerfile.api and proves on THIS machine (Docker, the AGENT stack, port 8001) that the image runs as a non-root user, refuses to start unconfigured, answers /health and /ready,
#                                 ignores a forged X-Forwarded-For, stops cleanly on SIGTERM, and runs the scheduler worker for one tick. docs/runbooks/hosting-env-and-secrets.md
#   make hosted-smoke URL=https://app.example.com API_URL=https://api.example.com   checks a RUNNING deployment (yours, hosted): health, readiness, the login page, the Host header the app sees, one API call, the error shape,
#                                 CORS, and the scheduler status (the last needs SMOKE_EMAIL; the password is typed hidden). Read-only. Exit 0 = no FAIL. docs/runbooks/hosting-rehearsal-owner.md
container-smoke:
	./deploy/container-smoke.sh

# Docker for the local Supabase stacks is Colima (job DE, docs/runbooks/colima.md): mounts the Stack19 volume, starts Colima if needed, selects its context, starts Supabase containers that died while the engine was away.
docker-up:
	./scripts/docker-up.sh

# STAGING (job DC, docs/ops/staging.md): the stack19-staging Google Cloud project (Mumbai) + the stack19-staging Supabase project; synthetic data only. Needs `gcloud auth login` and `supabase login`.
#   make deploy-staging [WHAT=api|web|worker|all] [DRY=1]   remote image build (Cloud Build) + deploy; DRY=1 prints the commands and runs none
#   make staging-status                                     what runs; make rollback-staging SERVICE=sme-api [REVISION=<name>]   traffic back to the previous (or the named) revision
#   make staging-smoke                                      the checks of a live staging: hosted-smoke, the API flows (quotes, campaigns) and the browser flow (sign-in, second factor, Today, sign-out)
#   make staging-backup / make staging-drill FILE=<dump>    a pg_dump to /Volumes/Stack19/stack19/staging-backups and the restore into a scratch database on the local AGENT stack
STAGING_API = https://sme-api-620338396268.asia-south1.run.app
STAGING_WEB = https://staging.stack19.com
STAGING_REF = uiallwgywitryxatcqxf
deploy-staging:
	./deploy/staging.sh deploy $(or $(WHAT),all) $(if $(DRY),--dry-run,)
staging-status:
	./deploy/staging.sh status
rollback-staging:
	@test -n "$(SERVICE)" || { echo "usage: make rollback-staging SERVICE=sme-api|sme-web [REVISION=<name>]"; exit 2; }
	./deploy/staging.sh rollback $(SERVICE) $(REVISION)
staging-latest:
	@test -n "$(SERVICE)" || { echo "usage: make staging-latest SERVICE=sme-api|sme-web"; exit 2; }
	./deploy/staging.sh latest $(SERVICE)
staging-smoke:
	$(PY)/python scripts/hosted_smoke.py --web "$(STAGING_WEB)" --api "$(STAGING_API)"
	python3 scripts/staging_smoke_api.py --i-know-this-is-staging --project-ref $(STAGING_REF) --api-url $(STAGING_API)
	node e2e/staging-smoke.mjs $(STAGING_WEB)
staging-backup:
	python3 scripts/staging_backup.py dump
staging-drill:
	@test -n "$(FILE)" || { echo "usage: make staging-drill FILE=/Volumes/Stack19/stack19/staging-backups/<name>.dump"; exit 2; }
	python3 scripts/staging_backup.py drill "$(FILE)"

hosted-smoke:
	@test -n "$(URL)" || { echo 'usage: make hosted-smoke URL=https://<web address> [API_URL=https://<api address>] (see docs/runbooks/hosting-rehearsal-owner.md)'; exit 2; }
	$(PY)/python scripts/hosted_smoke.py --web "$(URL)" $(if $(API_URL),--api "$(API_URL)",) $(SMOKE_ARGS)
