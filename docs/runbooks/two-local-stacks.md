# Two local stacks: the owner's demo and the agents' tests (job BG)

Until job BG there was one local Supabase stack. An agent that ran `make db-reset`, pgTAP or an integration test on it wiped or disturbed the owner's demo database and pinned its clock. Now there are **two, fully separate**: nothing is shared (not the database, not the Docker volumes, not a port).

| | **Owner's stack** (the demo) | **Agent stack** (tests) |
|---|---|---|
| Supabase project / folder | `sme-ai` / `supabase/` (the repository's own) | `sme-ai-agent` / `stacks/sme-ai-agent/` |
| Containers, volumes | `supabase_*_sme-ai` | `supabase_*_sme-ai-agent` |
| Supabase API (what `SUPABASE_URL` is) | `http://127.0.0.1:54321` | `http://127.0.0.1:54421` |
| Postgres | `54322` | `54422` |
| The app's API | `8000` | `8001` (the e2e run uses `8002`) |
| The web | `3000` | `3001` (the e2e run uses `3002`) |
| Started with | `make db-start` | `make agent-db-up` |
| Default for | the owner, by choice (`STACK=owner`) | **everything an agent runs** |

The agent stack's config is **generated** from the owner's (`scripts/gen_agent_stack.py`): the project id, the ports and the sign-in redirect addresses differ, and nothing else, so the two behave the same. `tests/test_stacks.py` fails if the committed file is stale or if any other setting differs. Its `migrations`, `tests` (pgTAP) and `templates` folders are **copies** of `supabase/`'s, made by `scripts/sb` before every command and git-ignored: there is one source of truth.

## For agents (Claude, Codex, anyone who is not the owner)

1. **Use the agent stack, always.** It is the default of every make target and script, so the usual commands are the right ones:

   ```
   make agent-db-up         # start it (once; Docker must be running)
   make db-reset            # rebuild the AGENT database from the migrations (drops its data)
   make db-test             # the full pgTAP suite on the AGENT database
   make test-integration    # integration tests against the AGENT stack
   make eval, make check    # the same, on the AGENT stack
   make agent-db-reset / make agent-db-test      # the same as db-reset / db-test, spelled out
   make agent-db-down       # stop it (frees about 2 GB of memory)
   make stack-info          # which stack this shell would use, and which containers are running
   ```

2. **Your own API and web: 8001 and 3001.** `AGENTS_ENABLED=true make dev-api-local API_PORT=8001` and `make dev-web-local API_PORT=8001 WEB_PORT=3001` follow the port: the default `8000` means the owner's stack, any other port means the agent stack. The seeds (`make seed-demo`, `seed-demo-manual`, `seed-demo-outbox`, `seed-demo-catalogue`) default to the agent stack and to `SEED_API_URL=http://localhost:8001`, so start your API on 8001 first: `export SEED_API_URL=http://localhost:8001`. A `.env` file never redirects an agent seed to the owner's API.
3. **Never** start, stop or bind anything on `3000`, `8000`, `54321`, `54322` or a process you did not start. Never `pkill -f`. Record the PID of what you start and stop only that PID.
4. **One test session at a time on the agent stack.** A pgTAP or integration session pins the database-wide clock; two at once collide. Check `pgrep -fl "pytest -c pyproject"` first. Two agents on one machine share this one agent stack, so they take turns.
5. **`supabase start` / `status` print the service-role key.** Redirect them to a file; never print or tail that output. The make targets and `scripts/sb` do not print keys; `scripts/with-local-supabase-env.sh` hands the apps only the public URL and the public keys.
6. If something refuses with "**OWNER's stack**", that is the guard doing its job. Do not set `OWNER_OK=1` to get past it. Use the agent stack.

## For the owner

Nothing about your demo changes, except that the agents' commands no longer reach it:

```
make db-start                       # your stack, as before
make dev-api-local                  # :8000 on your stack (the default port means yours)
make dev-web-local                  # :3000 on your stack
make seed-demo-manual STACK=owner   # the seeds default to the agents' stack: name yours
```

Your stack's **destructive** actions are refused unless you say so on purpose:

```
make db-reset STACK=owner OWNER_OK=1      # rebuild YOUR database (drops the demo data; re-seed after)
make db-test  STACK=owner OWNER_OK=1      # pgTAP on your database
make db-stop OWNER_OK=1                   # stop your stack
STACK=owner OWNER_OK=1 make test-integration   # only if you really mean it: it pins your clock
```

`OWNER_OK` must be exactly `1`. The refusals are in three places, so a mistake in one does not defeat the guard: `scripts/sb` (every Supabase CLI call: `db reset`, `stop`, `test db`, `db push`, `db pull`), `tests/integration/conftest.py` (the session aborts before any test if `SUPABASE_URL` is the owner's API port, or if it does not match the stack named), and `scripts/stack_env.py` (`require_owner_ok`, for scripts that reset or pin).

## How the choice is made

The stack is decided in this order, by the same rule in `scripts/stack.sh` (shell) and `scripts/stack_env.py` (Python); a test checks that they agree:

1. `SME_STACK=agent|owner` when set. `make` sets it from `STACK` (default `agent`); the serving targets set it from the port.
2. Otherwise the port of `SUPABASE_URL` (54321 is the owner's, 54421 the agent's), so a bare `pytest` against the owner's URL is still recognised as the owner's.
3. Otherwise `agent`.

Everything that needs the database container (`docker exec ... psql`) uses `supabase_db_<project>` of the chosen stack: `tests/integration/operator_sql.py` (flip a switch, pin a clock), `scripts/local_confirm.py`, `scripts/seed_demo.py`, `scripts/demo_code.py`, `scripts/dev-enable-*.sh`, `scripts/dev-api-hosted-free.sh`, the rehearsal harness, the mutation tools and the e2e libraries. A test (`test_nothing_but_the_stack_files_reads_a_project_id`) fails if a new script reads the owner's project id directly.

## CI

CI has one stack per runner, a plain `supabase start` of the repository's own `supabase/` project, and nothing of the owner's is on a runner. The workflow therefore sets `SME_STACK=owner` and `OWNER_OK=1` for the whole run (`.github/workflows/ci.yml`), which makes the scripts and the integration guard use that one stack. A new workflow job that starts Supabase needs the same two variables.

## Moving from the single stack

* The first `make agent-db-up` pulls nothing new (the images are shared) and takes about a minute; it needs about 2 GB of memory beside the owner's stack. The dashboard (Studio) is switched off on the agent stack to save memory.
* `docker volume ls | grep sme-ai-agent` shows the agent stack's volumes; `make agent-db-down` keeps them, `supabase stop --no-backup --workdir stacks/sme-ai-agent` removes them.
* A script of yours that ran `supabase status` or used `supabase_db_sme-ai` directly keeps working on the owner's stack. For the agent stack use `scripts/sb status -o env` (it prints keys: redirect it) and `$SME_DB_CONTAINER` after `. scripts/stack.sh`.
* Regenerate the agent config after a change to `supabase/config.toml`: `python3 scripts/gen_agent_stack.py` (`--check` is the test).

## The sign-up mail template and Kong (job CN)

Symptom (seen after the repository moved to the external SSD): after `make db-reset` the agent stack's sign-up mail carried the stock Supabase link, and `test_open_signup.py` and the demo-seed tests failed (the auth log showed a 404 for the template URL). The only cure was `docker restart supabase_kong_sme-ai-agent`.

Cause: the Supabase CLI gives Kong the mail template as a bind mount of the single **file** `stacks/sme-ai-agent/supabase/templates/confirmation.html`. A mount follows the file's inode. `scripts/gen_agent_stack.py --sync` (run by `scripts/sb` before every `start`, `db reset` and `test db`) used to rebuild the whole `templates` folder and rename it into place, so the file got a new inode while Kong kept the deleted one.

Fix: `templates` is now synced **in place** (`sync_in_place`): a file whose bytes are already right is not touched, a changed file is rewritten through the same inode, a file that left `supabase/templates` is removed. `migrations` and `tests` are still replaced as folders (nothing mounts them). `tests/test_stacks.py` pins the inode.

One-time step: a Kong container that was started *before* this fix may still hold a stale file. Recreate it once with `make agent-db-down` then `make agent-db-up` (or `docker restart supabase_kong_sme-ai-agent`); after that, resets need no manual step. If the template is ever *edited*, the edit is written through the same inode, so Kong sees it without a restart.

## One session at a time on a stack (the lock)

Each stack's database is one shared thing: a reset or pgTAP run rebuilds it, an integration test pins its clock, a real-stack browser run (`make e2e-local`, `e2e-packs`, `e2e-new-owner`) keeps data in it for minutes. Two sessions at once break each other. `scripts/db-lock.sh <command>` runs a command inside a lock
(`~/.cache/sme-ai/db-<stack>.lock`, a folder holding the holder's process number); the make targets that use the database (`agent-db-reset`, `agent-db-test`, `db-reset`, `db-test`, `test-integration`, `eval`) and `scripts/e2e-local.sh` take it for you and wait their turn (up to 45 minutes, `SME_DB_LOCK_WAIT`; then exit 75).
A dead holder's lock is taken over; the lock is re-entrant (`SME_DB_LOCK_HELD=1`); nothing is killed. Details and the reasons for a lock instead of a second database: `e2e/README.md`.

