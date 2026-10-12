"""Job BY (ADR 0077): migration 20261118090000 REPLACES, as a FULL COPY, the operator's `app.operator_add_owner_exception` and adds exactly the cap of three Owners. It must be the LAST definition of the function and
differ from the one before it by EXACTLY the lines named here, so a copy of an old definition can never silently undo a later fix."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

from tests.test_migration_copies import definitions, normalised

BY = "20261118090000_by_team_invitations.sql"
NAME = "app.operator_add_owner_exception"

ADDED = {
    "if (select count(*) from public.memberships m where m.tenant_id = v_tenant and m.role = 'owner') >= 3 then",
    "raise exception 'a workspace has at most three owners' using errcode = '22023';",
    "end if;",
}


def test_the_by_copy_is_the_last_definition_and_adds_exactly_the_owner_cap() -> None:
    defs = definitions(NAME)
    assert defs[-1][0] == BY, f"{NAME} is redefined after job BY's migration ({defs[-1][0]}): re-copy it from the latest definition"
    diff = [line for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0) if line[:1] in "+-" and not line.startswith(("---", "+++"))]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == set()
    assert {line[1:].strip() for line in diff if line[0] == "+"} == ADDED
