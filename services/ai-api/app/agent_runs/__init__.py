"""The HTTP side of agent runs (ADR 0013, T006 M2): start, list, cancel, tenant switch, claim
suggestions and their review.

Everything the agent itself does lives in the sandbox package `app.agents`; this package is
the authority around it: it authenticates the caller, checks the tenant and role, starts the
run through the database (which re-checks), and hands the run to a bounded in-process executor
together with the starter's token."""
