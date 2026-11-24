# C1 local branch: how to run it (localhost, staging database)
Branch `c1/local-all` (worktree /Volumes/Stack19/stack19/c1wt-b) = main + lists 1-4, out-of-stock, undo-price, pack categories, phone-lines, lead address, sign-up opening.
1. API: `./run-local-api.sh` (http://localhost:8000; reads secrets from Secret Manager into memory; uses the STAGING Supabase project; `VENV=/path/to/.venv` if the worktree has none).
2. The migrations of this branch must be on staging first (versions 990000 to 990700, plus main's): `cd deploy-worktree && supabase db push --linked` from a worktree LINKED TO STAGING (c1wt-deploy-23 after merging this branch). Not done yet unless the planner says so.
3. Web (C2): `NEXT_PUBLIC`/API base = http://localhost:8000, sign in with a staging account.
4. Sign-up proof: POST /v1/signup/phone/start answers `debug_code` (fake sender); then /phone/verify, /consent, /tenants/{t}/billing/trial-claim. `ops_signup_set(true)` must be run by a system account to open it (staging only).
5. Tests: only what you touched, through `lockf -k /tmp/stack19-heavy.lock`, e.g. `lockf -k /tmp/stack19-heavy.lock .venv/bin/python -m pytest tests/test_signup_routes.py -q`.
Flags on locally: SIGNUP_OPEN, SIGNUP_PHONE_SENDER=fake, SIGNUP_FAKE_CODE_ECHO, WHAT_YOU_SELL_LISTS, PRICING_V2. Production stays off.
