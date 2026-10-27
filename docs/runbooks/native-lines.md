# The native lines (job DS): how Vijaya's everyday spoken style is taught

The assistant's words come from a model that has read mostly books. To make it talk like the people in the shop, every prompt that writes words for a customer carries a **register block**: rules, plus seven of the owner's own example lines.

* The example files are `services/ai-api/app/agents/register/data/native_lines/<lang>.md` (en, te, hi, kn, ta, ml). Telugu is the owner's own and **approved**. The others are **drafts** written on its model; `GET /speaking-style` says `examples: "draft"` for them.
* To change a language: edit its file (keep the numbering: lines 1 to 8 are Opening, Stock + photos, Price answer, "Call me later", "Not interested" close, School admission, Delivery, Reminder; then "Often used" bullets). Mark it approved by changing `status` in `app/agents/register/data/register.json`. Run `cd services/ai-api && .venv/bin/pytest tests/test_ds_spoken_style.py`: every line must be spoken (no entry of the written-forms list), still read as that language (script share) and keep English words in Latin letters.
* The written-forms list (`formal_forms` in `register.json`) is a short tripwire used by `make model-compare` and `make register-ab`; add a form when a reader spots one the model keeps writing.
* Listening: `make voice-samples-spoken` (opt-in, 3,000 characters at most, Sarvam) writes `~/Desktop/stack19-jobs/voice-samples/spoken/index.html` with the earlier bookish lines beside the spoken ones.
* A native reader of hi, kn, ta, ml: read the file, correct the lines in place, tell the engineers; nothing else changes.
