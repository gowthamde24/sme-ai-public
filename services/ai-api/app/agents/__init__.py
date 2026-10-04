"""The agent runtime (ADR 0013, T006 M2).

This package is deliberately a SANDBOX: it may import nothing that carries authority (the
auth, tenancy or repository modules, the review code, secrets in the config). Its only door to
the data is `db.py` (the nine definer functions plus two read-only reads), its only door to a
model is `llm.interface`. tests/test_agents_boundary.py enforces that by reading the source."""
