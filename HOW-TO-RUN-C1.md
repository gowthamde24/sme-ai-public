# C1 local branch: how to run it (localhost, staging database)
Branch `c1/local-all` (worktree /Volumes/Stack19/stack19/c1wt-b) = main + lists 1-4, out-of-stock, undo-price, pack categories, phone-lines, lead address per job (+ activity, test lead, 12 connector guides), sign-up opening (+ WhatsApp sender), calls across API instances (CALL_COORDINATION), business KYC per client (KYC_PER_CLIENT), describe-the-job, ledger fixes.
1. API: `./run-local-api.sh` (http://localhost:8000; reads secrets from Secret Manager into memory; uses the STAGING Supabase project; `VENV=/path/to/.venv` if the worktree has none).
2. STAGING ALREADY HAS the migrations of this branch (through 991500, pushed from this worktree, linked to staging uiallwgywitryxatcqxf). Later ones: `supabase db push --linked --dry-run` first; never from the main checkout (production).
3. Web (C2): `NEXT_PUBLIC`/API base = http://localhost:8000, sign in with a staging account.
4. Sign-up proof: POST /v1/signup/phone/start answers `debug_code` (fake sender); then /phone/verify, /consent, /tenants/{t}/billing/trial-claim. `ops_signup_set(true)` must be run by a system account to open it (staging only).
5. Tests: only what you touched, through `lockf -k /tmp/stack19-heavy.lock`, e.g. `lockf -k /tmp/stack19-heavy.lock .venv/bin/python -m pytest tests/test_signup_routes.py -q`.
Contracts: docs/contracts/{sell-lists,signup,calls,business-kyc,jobs-describe}.md. Flags on locally: SIGNUP_OPEN, SIGNUP_PHONE_SENDER=fake, SIGNUP_FAKE_CODE_ECHO, WHAT_YOU_SELL_LISTS, PRICING_V2. Production stays off.
