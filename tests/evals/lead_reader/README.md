# AI lead reader evals (owner decision, 31 Oct 2026)

`cases.jsonl`: WhatsApp enquiries in English, Telugu, Tenglish (Telugu in Latin letters), Hindi and Kannada. Per case:
`text` (what the customer wrote), `canned` (what a good model answers: used OFFLINE in CI to prove that the checks accept it), `expect` (field -> substrings, ANY one of which must be in the value), `forbid` (fields that must stay empty).

* Offline (CI, `tests/test_or_lead_reader.py`): every `canned` answer passes `verified_fields`, a hallucinated number / a phone number / an address is dropped from it, an injection in the words changes nothing.
* Live (opt-in, spends a few model calls; key from the environment only): `CASES=tests/evals/lead_reader/cases.jsonl ANTHROPIC_API_KEY=... python scripts/lead_reader_eval.py --model <light model>` runs the real model through the same reader and checks `expect` / `forbid`. The last run is in `~/Desktop/stack19-jobs/casual-check/lead-reader.md`.
