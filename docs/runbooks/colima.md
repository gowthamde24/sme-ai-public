# Runbook: Docker through Colima (job DE)

OrbStack is not free for business use, so the local Supabase stacks (the owner's demo and the agent test stack) run on **Colima**, an open-source Docker engine in a small Linux VM. Nothing else about the stacks changed:
same Supabase CLI, same container names (`supabase_db_sme-ai`, `supabase_db_sme-ai-agent`), same ports (543xx and 544xx).

## One-time install (done on this Mac, 2026-10-24)
`brew install colima docker docker-credential-helper`. The last one matters: `~/.docker/config.json` says `credsStore: osxkeychain`, and the `docker-credential-osxkeychain` helper in `/usr/local/bin` was a link into the OrbStack app, so image pulls would have broken the day OrbStack is removed. Homebrew's own copy comes first in the PATH (`which -a docker docker-credential-osxkeychain` lists `/opt/homebrew/bin` first). `docker-compose` is not used by anything in this repository (the Supabase CLI talks to the engine directly).

## Every day

```
make docker-up          # (= scripts/docker-up.sh) safe to run any time; it only does what is missing
make db-start           # the owner's demo stack      make agent-db-up   # the agent stack
bash ~/Desktop/v2-overnight/start-demo.sh   # the demo; it calls docker-up for you
```
`docker-up` does four things: (1) mounts the **Stack19 volume** if it is not mounted; (2) starts Colima if it is not running; (3) runs `docker context use colima`, so `docker`, the Supabase CLI, the e2e helpers and the make targets all talk to Colima; (4) `docker start`s any Supabase container that exited while the engine or the volume was away.

## The size, and why
2 CPUs, **3 GB**, 40 GB disk, Apple's virtualization framework (`vz`) with virtiofs mounts. The Mac has 8 GB and was already into swap. Measured with both stacks up: the owner's stack **860 MiB** (it runs Studio and pg_meta), the agent's **277 MiB**, about 1.1 GB in all; so 3 GB holds both with room for Postgres's own cache and the odd `docker run`, and leaves macOS, the browser and the dev servers 5 GB. (The first guess was 4 GB; the measurement said that was a gigabyte too many for this Mac.) 2 CPUs are enough for a database and its small services. Heavy steps (`make check`, e2e, perf) still go inside the lock:
`until mkdir ~/Desktop/v2-overnight/heavy.lock 2>/dev/null; do sleep 30; done; <cmd>; rmdir ~/Desktop/v2-overnight/heavy.lock`. To change the size: edit `scripts/docker-up.sh`, then `colima stop && make docker-up` (images and volumes stay).

## Why the volume comes first ("the agent stack ran without its API gateway")
The repository lives on the **Stack19** volume (a sparsebundle on the SSD, mounted at `/Volumes/Stack19`). Kong bind-mounts its e-mail templates from it, and the database its init scripts. If an engine (re)starts while the volume is not mounted, Docker cannot create the mount (`mkdir /Volumes/Stack19: permission denied`), the container exits with code 255 and, because its restart policy is `unless-stopped`, is never tried again: the stack then "runs" without Kong (and `supabase status` prints "Stopped services: supabase_kong_…"), so `scripts/with-local-supabase-env.sh` fails with `API_URL: unbound variable`. It was a setup problem, not a Supabase one: `make docker-up` repairs it (mount, then start the dead containers).
Colima has the same dependency: its VM mounts `/Volumes/Stack19` when it starts, so mount the volume before `colima start` (docker-up does).

## Moving the data of a stack from another engine (done once, 2026-10-24)
Both engines keep their data in named volumes; the files are the same (Postgres 17 on arm64), so the owner stack's `supabase_db_sme-ai` and `supabase_storage_sme-ai` volumes were tarred out of OrbStack and untarred into Colima before the first `make db-start`: database as is, storage with **`--xattrs`** (the storage backend keeps each object's content type and cache control in file extended attributes; BusyBox `tar` drops them, GNU `tar` in a `debian:bookworm-slim` container keeps them). The archives are in `~/Desktop/v2-overnight/owner-demo-volumes-*/`. The agent stack is disposable and starts empty.

## If something is off
| Symptom | Fix |
|---|---|
| `Cannot connect to the Docker daemon` | `make docker-up` |
| `docker context ls` shows another context starred | `docker context use colima` |
| a Supabase container is "Exited (255)" | `make docker-up` (starts it again; check the Stack19 volume is mounted) |
| `supabase status` says "Stopped services" | the same |
| the VM is short of memory | `docker stats --no-stream`; stop the stack you are not using (`make agent-db-down`) |
| start over with a clean engine | `colima delete` removes the VM AND its volumes (the stacks' data!); the owner stack's data is in `~/Desktop/v2-overnight/owner-demo-volumes-*` |
