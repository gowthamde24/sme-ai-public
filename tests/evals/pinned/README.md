# Language pill evals (owner, 31 Oct 2026)

`cases.jsonl`: typed turns through the real model on staging (`POST /assistant/turns`) with the `language` the person chose on the assistant bar (a code, `auto`, or absent). `expect_script`: the reply must be in that language's script (Latin for en). Run with the casual-check runner: `CASES=tests/evals/pinned/cases.jsonl OUT=pinned-language.md python run.py <repo checkout>`; its `language` field is sent on the turn. Offline (CI) the choice itself is pinned by `tests/test_or_language_pill.py` and four cases in `tests/evals/regression`.
