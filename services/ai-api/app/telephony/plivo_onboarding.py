"""Setting a business up on Plivo (job 3 phase C, 10 Nov 2026), step by step and resumable. It is an OPERATOR tool (scripts/plivo_onboard.py runs it on a trusted machine, like the operator SQL of the other runbooks): no HTTP
endpoint exists for it because the API has no operator sign-in, and a key that could rent numbers must not be one more secret in a web request.

  1. the business's own compliance application is `accepted` (made by the business with Plivo, or by the owner in the console for Customer Zero: we never file one and never see a document); until then nothing is bought
  2. a SUBACCOUNT for the business; its Auth Token goes straight into Secret Manager as `sme-ws-<workspace id>-plivo-token` (the name the line's `account_ref` carries) and is never printed
  3. the number the operator named is rented into the subaccount, backed by that application (this costs money: only with --execute and an explicit --number)
  4. an XML Application under the subaccount with OUR answer and hangup addresses
  5. the number is linked to the Application
  6. the line's row for the operator to run (public.phone_numbers: provider plivo, account_ref, external_ref, inbound off until the first test call has passed)

Dry run by default: it says what it WOULD do and calls nothing but the free reads (the application's status). Each step skips itself when its result already exists, so a run that stopped half way is run again."""

# ruff: noqa: E501

from __future__ import annotations

import re
import subprocess
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

from app.telephony.plivo_admin import PlivoAdmin, e164
from app.telephony.plivo_api import PlivoError

SECRET_SUFFIX = "plivo-token"  # noqa: S105 - a name, not a password


def vault_key(tenant_id: uuid.UUID) -> str:
    """The name of the secret that holds a business's subaccount token. It matches phone_numbers.account_ref's pattern and the sme-ws-* IAM bindings."""
    return f"sme-ws-{tenant_id}-{SECRET_SUFFIX}"


class SecretWriter(Protocol):
    def exists(self, name: str) -> bool: ...
    def put(self, name: str, value: str) -> None: ...


class GcloudSecretWriter:
    """Secret Manager through the `gcloud` of the operator's machine; the value goes in on stdin, never in an argument (so never in a process list or shell history)."""

    def __init__(self, project: str, *, run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run) -> None:
        if not re.fullmatch(r"[a-z][a-z0-9-]{4,62}", project):
            raise ValueError("not a Google Cloud project id")
        self._project, self._run = project, run

    def _gcloud(self, *args: str, value: str | None = None) -> subprocess.CompletedProcess[str]:
        return self._run(["gcloud", *args, "--project", self._project], input=value, capture_output=True, text=True, check=False)

    def exists(self, name: str) -> bool:
        return self._gcloud("secrets", "describe", name, "--format=value(name)").returncode == 0

    def put(self, name: str, value: str) -> None:
        if not self.exists(name):
            made = self._gcloud("secrets", "create", name, "--replication-policy=user-managed", "--locations=asia-south1", "--labels=app=stack19,kind=workspace-key", "--data-file=-", value=value)
        else:
            made = self._gcloud("secrets", "versions", "add", name, "--data-file=-", value=value)
        if made.returncode != 0:
            raise RuntimeError("the secret could not be written")   # (gcloud's own text is dropped: it must never carry the value)


@dataclass(frozen=True)
class OnboardPlan:
    tenant_id: uuid.UUID
    business: str
    compliance_id: str
    public_base: str
    number: str | None = None            # the number to rent (explicit: a purchase is never picked for the operator)
    subaccount_id: str | None = None     # when a previous run already made it
    application_id: str | None = None    # when a previous run already made it
    pattern: str = ""                    # for the free search of numbers on offer (--number not given)


@dataclass
class Step:
    name: str
    status: str     # done | would | skipped | waiting | failed
    detail: str = ""


@dataclass
class OnboardResult:
    steps: list[Step] = field(default_factory=list)
    subaccount_id: str | None = None
    application_id: str | None = None
    number: str | None = None
    offered: list[str] = field(default_factory=list)
    sql: str | None = None

    def add(self, name: str, status: str, detail: str = "") -> None:
        self.steps.append(Step(name, status, detail))


def line_sql(tenant_id: uuid.UUID, number: str, subaccount_id: str, business: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.-]{4,100}", subaccount_id):
        raise ValueError("not a subaccount id")
    spoken = re.sub(r"[^\w .&-]", "", business)[:60]   # letters, digits, space . & - only: it is put inside a SQL string the operator will run
    return (f"insert into public.phone_numbers (tenant_id, number, label, inbound_on, provider, account_ref, external_ref, spoken_business_name) values ('{tenant_id}', '{e164(number)}', 'Plivo line', false, 'plivo', "  # noqa: S608 - printed for the operator; every value is a uuid, digits, a checked id or a cleaned name
            f"'{vault_key(tenant_id)}', '{subaccount_id}', '{spoken}') on conflict (number) do update set provider = 'plivo', account_ref = excluded.account_ref, external_ref = excluded.external_ref;\n"
            f"-- after the first test call has passed:  update public.phone_numbers set inbound_on = true where number = '{e164(number)}';")


def onboard(plan: OnboardPlan, main: PlivoAdmin, store: SecretWriter, sub_admin: Callable[[str, str], PlivoAdmin], *, execute: bool, token_of: Callable[[str], str | None] = lambda _id: None) -> OnboardResult:
    """Run the steps. `main` has the main account's credentials, `sub_admin(id, token)` makes a client with a subaccount's, `token_of(subaccount id)` reads a stored token back (to resume). Stops at the first step that
    cannot go on and says why; never raises for a Plivo refusal (it is a failed step with a closed word)."""
    out = OnboardResult(subaccount_id=plan.subaccount_id, application_id=plan.application_id, number=plan.number)
    base = plan.public_base.rstrip("/")
    answer, hangup = f"{base}/v1/telephony/plivo/answer", f"{base}/v1/telephony/plivo/hangup"
    try:
        status = main.compliance_status(plan.compliance_id)
    except PlivoError as exc:
        out.add("compliance", "failed", exc.reason)
        return out
    if status != "accepted":
        out.add("compliance", "waiting", f"the business's application is `{status}`; nothing is bought until it is `accepted`")
        return out
    out.add("compliance", "done", "accepted")
    store_key = vault_key(plan.tenant_id)
    token: str | None = None
    # 2. the subaccount
    if out.subaccount_id and store.exists(store_key):
        out.add("subaccount", "skipped", f"{out.subaccount_id} exists and its token is stored under its key")
        token = token_of(out.subaccount_id)
    elif not execute:
        out.add("subaccount", "would", "create a subaccount for the business and store its token in Secret Manager under its key")
    else:
        try:
            kept: list[str] = []

            def keep(value: str) -> None:
                store.put(store_key, value)   # straight into Secret Manager
                kept.append(value)              # and in memory for the Application step of THIS run only

            sub_id = main.create_subaccount(f"stack19-{str(plan.tenant_id)[:8]}", keep)
            token = kept[0] if kept else None
            out.subaccount_id = sub_id
            out.add("subaccount", "done", f"{sub_id}; its token is stored in Secret Manager")
        except (PlivoError, RuntimeError) as exc:
            out.add("subaccount", "failed", getattr(exc, "reason", "secret_not_written"))
            return out
    # 3. the number
    if not plan.number:
        try:
            out.offered = main.search_numbers(pattern=plan.pattern)
        except PlivoError as exc:
            out.add("number", "failed", exc.reason)
            return out
        out.add("number", "waiting", "name the number to rent with --number (nothing is bought on its own): on offer " + (", ".join(out.offered) or "none"))
        return out
    if not execute:
        out.add("number", "would", f"rent {e164(plan.number)} into the subaccount, backed by the accepted application (this costs money: the monthly rent)")
    elif out.subaccount_id is None:
        out.add("number", "failed", "no subaccount yet")
        return out
    else:
        try:
            main.buy_number(plan.number, subaccount_id=out.subaccount_id, compliance_application_id=plan.compliance_id)
            out.add("number", "done", f"{e164(plan.number)} rented")
        except PlivoError as exc:
            out.add("number", "failed", exc.reason)
            return out
    # 4. the Application, with the subaccount's own credentials
    if out.application_id:
        out.add("application", "skipped", out.application_id)
    elif not execute:
        out.add("application", "would", f"create an XML Application with answer {answer} and hangup {hangup}")
    elif out.subaccount_id is None or token is None:
        out.add("application", "failed", "the subaccount's token is not at hand (run again with --subaccount-id after the token is stored)")
        return out
    else:
        try:
            out.application_id = sub_admin(out.subaccount_id, token).create_application(f"stack19-{plan.business[:30]}", answer, hangup)
            out.add("application", "done", out.application_id)
        except PlivoError as exc:
            out.add("application", "failed", exc.reason)
            return out
    # 5. link
    if not execute:
        out.add("link", "would", f"point {e164(plan.number)} at the Application")
    elif out.application_id is None or out.subaccount_id is None or token is None:
        out.add("link", "failed", "no Application yet")
        return out
    else:
        try:
            sub_admin(out.subaccount_id, token).link_number(plan.number, out.application_id)
            out.add("link", "done", f"{e164(plan.number)} -> {out.application_id}")
        except PlivoError as exc:
            out.add("link", "failed", exc.reason)
            return out
    # 6. the line's row
    if out.subaccount_id:
        out.sql = line_sql(plan.tenant_id, plan.number, out.subaccount_id, plan.business)
        out.add("line", "done", "run the SQL below as the operator (inbound stays off until the first test call passes)")
    else:
        out.add("line", "would", "the SQL for public.phone_numbers is printed once the subaccount exists")
    return out
