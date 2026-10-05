"""Typed outcomes of the agent database module. Each class stands for one SQLSTATE of ADR 0013's
error contract and carries NO text: `str(error)` is a constant code, because database
messages, details and hints are never forwarded, logged or stored."""

from __future__ import annotations


class AgentDbError(Exception):
    sqlstate = ""
    code = "data_layer_error"

    def __init__(self) -> None:
        super().__init__(self.code)


class RunDenied(AgentDbError):
    """42501: unknown run, someone else's run, a lost role: deliberately indistinguishable."""

    sqlstate = "42501"
    code = "run_denied"


class RunNotRunning(AgentDbError):
    sqlstate = "SM201"
    code = "run_not_running"


class RunExpired(AgentDbError):
    sqlstate = "SM202"
    code = "run_expired"


class BudgetExhausted(AgentDbError):
    sqlstate = "SM203"
    code = "budget_exhausted"


class AgentsDisabled(AgentDbError):
    sqlstate = "SM204"
    code = "agents_disabled"


class StepConflict(AgentDbError):
    sqlstate = "SM205"
    code = "step_conflict"


class LimitReached(AgentDbError):
    sqlstate = "SM206"
    code = "limit_reached"


class CostCapReached(AgentDbError):
    """SM207: the tenant's daily cost cap has no room for the model call (or the model has no
    usable price: fail closed, the same refusal)."""

    sqlstate = "SM207"
    code = "cost_cap_reached"


class ValueRefused(AgentDbError):
    """22023 / 23514: an argument or a value the database does not accept."""

    sqlstate = "23514"
    code = "value_refused"


class ReferenceRefused(AgentDbError):
    sqlstate = "23503"
    code = "reference_refused"


class DataLayerUnavailable(AgentDbError):
    """Anything else: a network error, a 5xx, a SQLSTATE nobody planned for. The text is never
    kept."""

    code = "data_layer_unavailable"


BY_SQLSTATE: dict[str, type[AgentDbError]] = {
    cls.sqlstate: cls
    for cls in (
        RunDenied,
        RunNotRunning,
        RunExpired,
        BudgetExhausted,
        AgentsDisabled,
        StepConflict,
        LimitReached,
        CostCapReached,
        ValueRefused,
        ReferenceRefused,
    )
}
BY_SQLSTATE["22023"] = ValueRefused
