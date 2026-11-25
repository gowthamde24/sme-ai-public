# Entering the assistant's configuration sheet in one run (C1, 26 Nov 2026)
After the owner has created Customer Zero's workspace, `scripts/apply_assistant_config.py` writes the whole sheet (`reports/customer-zero-configuration-sheet.md`, values in `deploy/customer-zero-assistant.json`) through the app's own API, in about a minute instead of fifteen clicks.

**It is run by the OWNER, in his own Terminal.** These settings need his second factor in the app, so an operator database statement is never used (it would write them without it). He types his e-mail, password and the current authenticator code at hidden prompts; nothing is echoed, stored or logged.
```
export HOSTED_SUPABASE_PUBLISHABLE_KEY=<the public key: supabase projects api-keys>
cd /Volumes/Stack19/stack19/sme-ai-public
services/ai-api/.venv/bin/python scripts/apply_assistant_config.py --workspace <slug> \
  --supabase-url https://ijmsusgyilwskpjxfauu.supabase.co --api https://sme-api-488341211094.asia-south1.run.app \
  --days 1-6 --from 10:00 --to 19:00            # the shop's own days and hours
```
1. First run = a DRY RUN: it prints what would change ("assistant.style: 'warm' -> 'respectful'", ...). Read it with the planner. Nothing is written.
2. Add `--apply` and run again: it writes the assistant settings, the Telugu voice, how the assistant speaks (tone, AI mention off), the never-say list and the first questions. A value already set is not written again.
3. `may_answer_prices` stays OFF until a price list is loaded (the script checks `GET /price-lists/current`); run it again after the price list is in.
4. The Telugu greeting is written ONLY with `--greeting-te "..."` after the owner has said yes to the wording.
Not covered (the owner or planner does them once): the workspace's name/address/hours/GST (Settings > About my business), the 500 free minutes and the plan (operator statements), the shop numbers secret. Undo: every value can be changed on the My assistant screens; the dry run shows the difference again.
