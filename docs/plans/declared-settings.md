# Plan: every setting of a service is declared in the repo (owner, 12 Nov 2026)

**Status (12 Nov 2026): steps 1 to 3 and 5 for the STAGING API are BUILT (`deploy/settings.py`, `deploy/settings/staging/`); the production API, the worker and the web are still to do (steps 4 and 6).** What was built before: deploys only UPDATE settings, the API revision is made without traffic, checked against the serving revision, and only then given the traffic (`deploy/api_guard.sh`, `deploy/flag_guard.py`).
Order: production first (it has no hand-set history yet, so it starts clean), staging follows.

## Why (the incident of 12 Nov 2026)
`make deploy-staging WHAT=api` replaced the whole environment (`--set-env-vars`). The telephony block was only added when the SHELL that ran the deploy had `TELEPHONY_INBOUND=1` (and `API_MIN_INSTANCES=1`, `TELEPHONY_OUTBOUND`, `TASKS_DIALER`). Revisions 00152 to 00157 were deployed with those words typed in front of the command (the runbooks say so), so they kept the settings. 00158 was deployed bare:
22 settings (TELEPHONY_*, EXOTEL_*, PLIVO_*, PUBLIC_BASE_URL, the scheduler login, TASKS_DIALER) and the warm instance were gone, and the check ran after the revision had all the traffic. The real fault is that the truth about a deploy lived in somebody's command line and in what was last typed by hand, not in the repository.

## Target
1. **One versioned file per service and environment**, in the repo, reviewed like code:
   `deploy/settings/<env>/api.env` (plain values: `NAME=value`), `deploy/settings/<env>/api.secrets` (`NAME=secret-name`, always `:latest`, never a value), the same for `worker` and `web` (the web already has `deploy/staging-web-flags.env`; it becomes the first file of this kind).
   Public values only. A secret is a NAME in Secret Manager; the value is created by the owner at a hidden prompt, as today. A comment on every line says who decided it and when.
2. **The deploy reads the files and nothing else.** No setting comes from the deployer's shell (`TELEPHONY_INBOUND=1 ...` goes away). A switch the owner flips is a one-line PR to the file (so it has an author, a date and a review) and the next deploy applies it.
3. **The check compares three things, not two:** the file, the serving revision, the new revision. A difference between the file and the serving revision is DRIFT (someone used `gcloud run services update` by hand): the deploy prints it and stops until the file or the service is corrected. A difference between the file and the new revision is a bug in the script. Today only "serving vs new" is compared.
4. **`deploy/settings.sh diff <env>`** (read-only, no deploy): file vs what runs. Run in the morning report and before every owner step, so drift is seen in a day, not at the next deploy.
5. **Instances and CPU are settings too:** `min-instances`, `max-instances`, `concurrency`, `cpu-throttling` are lines in the same file (`@minScale=1`), checked the same way.
6. **Removing a setting is explicit:** a line in the file `-NAME` (the script passes `--remove-env-vars`), so a deleted line cannot silently keep running in the service.
7. **Production gets one more rule:** the file for production can change only in a PR that the owner approves (CODEOWNERS), and a change to `TELEPHONY_MODE`, `TASKS_DIALER`, `TELEPHONY_OUTBOUND` or the real-data gate names itself in the PR title.

## Steps
| # | Step | Where | Needs |
|---|---|---|---|
| 1 | Snapshot the serving staging revision into `deploy/settings/staging/*` (`flag_guard.py snapshot`, turned into the two file formats). Review every line with the owner once. | C1 | owner reads the list |
| 2 | `deploy/settings.sh` reads the files, builds `--update-env-vars` / `--update-secrets` / `--remove-*`, and is what `staging.sh` / `production.sh` call. The old environment-variable switches (`TELEPHONY_INBOUND`, `API_MIN_INSTANCES` ...) are removed, with the runbook lines that mention them. | C1 | none |
| 3 | The three-way check and `settings.sh diff`. | C1 | none |
| 4 | **Production**: write `deploy/settings/production/*` from `production.sh`'s current block, BEFORE the first production deploy, so the first revision already comes from the file. | C1 | the production project id (bring-up step 2) |
| 5 | Staging switches over on its next deploy after the owner has read step 1's list. | C1 | owner's yes |
| 6 | The worker job and the web service follow the same files (the worker's WhatsApp fence is the one value today read from the live job at deploy time; it becomes a line in the file). | C1, C2 (web) | none |

## What this does not do
It does not protect against someone editing a service by hand in the console between two deploys: step 3 and step 4 only make that visible. Cloud Run has no setting that forbids it; the answer is the morning `diff` and the habit of changing the file first.
