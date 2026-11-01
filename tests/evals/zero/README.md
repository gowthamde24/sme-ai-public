# Zero-amount wording cases (live model)

The assistant never reads out a zero: "No money is pending", not "₹0.00" (owner review, 1 Nov 2026). Run against staging with the casual-check harness:

    CASES=tests/evals/zero/cases.jsonl OUT=zero-check.md PACK=textiles python ~/Desktop/stack19-jobs/casual-check/run.py <repo checkout>

A reply fails when `app.assistant.wording.reads_a_zero` finds a zero amount or a zero count in it (the harness applies it to every case that has `"no_zero": true`).
