"""The follow-up rehearsal (T010 part 2, commit 4; docs/rehearsal-followups-checklist.md).

Two ways to run it, both on the LOCAL stack, both through OUR API as the people of a small workspace (Owner, Admin, Sales, Viewer):

  * `make rehearse-prepare-followups`: builds a clean synthetic workspace for the owner to click through by hand: a follow-up policy in force and nine leads in the nine states of the
    checklist. Nothing else happens. It prints how to sign in.
  * `make rehearse-followups`: builds the same workspace, then runs the whole follow-up journey headless and ASSERTS each step, every refusal the owner will see, and that nothing could
    have been sent. It writes `rehearsal-followups-report.md` at the repository root (git-ignored).

Every run makes a NEW workspace (its slug carries the run's tag and every id is scoped by it), because the history is dated relative to "now" (a touch five days ago): a repeat run is a new
workspace, never a half-repeated one, and no `make db-reset` is needed. Each write is still sent twice (a retry) and the second must be accepted.

It decides nothing: no cadence rule, gate or lifecycle rule lives here. The only knowledge in it is the expected result of each step, written down from the migrations and ADR 0022 BEFORE the
first run. Operator SQL is used in exactly three places, each said where it happens: (1) a lead's creation time is moved back 30 days (the API cannot: a touch may not be older than its lead,
and a touch five days ago is the point); (2) counts of rows and of keys, never a value; (3) the day of the database, to start the policy today. Everything is synthetic. Nothing is sent to anyone."""

# ruff: noqa: E501, S603, S607, S608

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import harness
from drive import API_DIR, ENQUIRIES, SYNTHETIC_KEY, Rehearsal, RunResult, iso, prepare
from fastapi.testclient import TestClient
from harness import Api, Deviation, NetworkGuard, People, Recorder, Stack, operator_sql, rid
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "rehearsal-followups-report.md"
ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
LEAD_KEYS = (
    "due_now",
    "not_yet",
    "replied",
    "suppressed",
    "order_accepted",
    "no_first_touch",
    "touch_limit",
    "questions",
    "reply_after_draft",
)

# (key, label shown on the screen, contact name, phone). Invented; the "+00" numbers and the .test addresses cannot belong to anyone.
LEAD_SPEC: dict[str, tuple[str, str, str]] = {
    "due_now": ("FU1 Due Now Silks", "Asha Duenow", "+00 90000 20001"),
    "not_yet": ("FU2 Not Yet Sarees", "Bala Notyet", "+00 90000 20002"),
    "replied": ("FU3 Replied Weaves", "Chitra Replied", "+00 90000 20003"),
    "suppressed": ("FU4 Opted Out Traders", "Dev Optedout", "+00 90000 20004"),
    "order_accepted": ("FU5 Order Accepted Looms", "Esha Ordered", "+00 90000 20005"),
    "no_first_touch": ("FU6 Never Contacted Silks", "Farid Nofirst", "+00 90000 20006"),
    "touch_limit": ("FU7 Three Touches Sarees", "Gita Limit", "+00 90000 20007"),
    "questions": ("FU8 Questions Weaves", "Hari Questions", "+00 90000 20008"),
    "reply_after_draft": ("FU9 Reply After Draft Silks", "Indu Afterdraft", "+00 90000 20009"),
}
LEAD_NO = {key: n for n, key in enumerate(LEAD_KEYS, start=1)}


def noon_offset(now: datetime) -> int:
    """The fixed UTC offset (minutes) that makes the recipient's local clock read about 12:00 right now (the rule of pgTAP file 65 and of tests/integration/followup_support.py)."""
    minute = now.astimezone(UTC).hour * 60 + now.astimezone(UTC).minute
    offset = (720 - minute + 1440) % 1440
    return offset - 1440 if offset > 840 else offset


@dataclass
class Lead:
    key: str
    lead_id: str
    contact_id: str
    company_id: str
    email: str
    phone: str


@dataclass
class Facts:
    """What the run learned that the report and the checklist quote (never a secret): the closed texts and the ids of the leads."""

    texts: dict[str, str] = field(default_factory=dict)
    sentences: list[tuple[str, int, str | None, str | None]] = field(
        default_factory=list
    )  # (step, status, code, reason) of every refusal reached
    leads: dict[str, str] = field(default_factory=dict)
    pages: dict[str, dict[str, Any]] = field(
        default_factory=dict
    )  # what each lead's page showed right after the preparation: the gate and the rules' answer
    due: dict[str, tuple[str, str, int | None]] = field(
        default_factory=dict
    )  # the due list as the page gets it: (action, reason, touch number)
    run_tag: str = ""
    tenant_id: str = ""


class FollowupRehearsal:
    def __init__(
        self,
        api: Api,
        people: People,
        tenants: dict[str, str],
        rec: Recorder,
        stack: Stack,
        tag: str,
        now: datetime,
    ) -> None:
        self.api, self.people, self.tenants, self.rec, self.stack, self.tag, self.now = (
            api,
            people,
            tenants,
            rec,
            stack,
            tag,
            now,
        )
        self.tenant = tenants["a"]
        self.leads: dict[str, Lead] = {}
        self.facts = Facts(run_tag=tag, tenant_id=self.tenant)
        self.order_id = ""
        self.requirement_id = ""
        self._legacy: Rehearsal | None = None

    # ------------------------------------------------------------------------------ small helpers
    @staticmethod
    def i(*parts: object) -> str:
        return rid("fu", *parts)

    def path(self, key: str, tail: str) -> str:
        return f"/leads/{self.leads[key].lead_id}{tail}"

    def refuse(
        self,
        step: str,
        who: str,
        method: str,
        path: str,
        body: Any,
        status: int,
        code: str,
        reason: str | None = None,
        *,
        weak: bool = False,
        tenant: str = "a",
    ) -> Any:
        """An attempt a person will see refused: the status, the closed code and the closed reason are each compared with the hand-worked ones."""
        r = self.api.probe(
            step,
            who,
            method,
            path,
            body,
            expect=(status,),
            code=code,
            reason=reason,
            weak=weak,
            tenant=tenant,
        )
        self.facts.sentences.append((step, r.status, r.code, r.reason))
        return r

    def read(self, key: str, who: str = "sales") -> dict[str, Any]:
        body: dict[str, Any] = self.api.get(
            f"{LEAD_NO[key]}: open the lead's follow-up page",
            who,
            self.path(key, "/followup?channel=email"),
            lead=f"FU{LEAD_NO[key]}",
        ).body
        self.facts.pages.setdefault(
            key, {"gate": body["gate"], "decision": body["decision"]}
        )  # the first look, right after the preparation (the checklist quotes it)
        return body

    # ------------------------------------------------------------------------------ the workspace, its people and the policy
    def policy(self) -> None:
        api, rec = self.api, self.rec
        today = operator_sql(
            "select app.quote_today()"
        )  # operator SQL (3): the database's own day, so the policy starts today
        body = {
            "id": self.i("policy", 1),
            "effective_from": today,
            "gap_days": [1, 2],  # a 1-day first gap, then 2 days
            "max_touches": 3,
            "quiet_start": "03:00",
            "quiet_end": "04:00",
            "allowed_weekdays": ALL_WEEKDAYS,
            "holidays": [],
            "min_gap_hours": 0,
            "recipient_utc_offset_minutes": noon_offset(
                self.now
            ),  # the recipient's clock reads about noon now, so "due" is true whenever the owner runs it within a few hours
        }
        self.refuse(
            "policy: a Sales user tries to publish",
            "sales",
            "POST",
            "/followup-policy-versions",
            body,
            403,
            "forbidden",
        )
        self.refuse(
            "policy: an Owner without the authenticator code tries to publish",
            "owner",
            "POST",
            "/followup-policy-versions",
            body,
            403,
            "mfa_required",
            weak=True,
        )
        self.refuse(
            "policy: a Viewer tries to read the versions",
            "viewer",
            "GET",
            "/followup-policy-versions",
            None,
            403,
            "forbidden",
        )
        made = api.call(
            "policy: the Owner publishes version 1",
            "owner",
            "POST",
            "/followup-policy-versions",
            body,
            expect=(200, 201),
        ).body
        rec.check(
            "policy: version 1 starts today",
            (1, today),
            (made["version_no"], made["effective_from"]),
        )
        listed = api.get("policy: read the versions", "sales", "/followup-policy-versions").body
        rec.check(
            "policy: one version, the one published",
            [self.i("policy", 1)],
            [v["id"] for v in listed],
        )

    # ------------------------------------------------------------------------------ the leads
    def make_lead(self, key: str) -> Lead:
        api = self.api
        label, person, phone = LEAD_SPEC[key]
        n = LEAD_NO[key]
        email = f"fu{n}-{key.replace('_', '-')}@fu-rehearsal.example.test"
        company, contact, lead = self.i(key, "company"), self.i(key, "contact"), self.i(key, "lead")
        api.call(
            f"{n}: the company",
            "sales",
            "POST",
            "/companies",
            {"id": company, "name": label, "city": "Pune"},
            lead=f"FU{n}",
        )
        api.call(
            f"{n}: the contact (the API computes the suppression keys)",
            "sales",
            "POST",
            "/contacts",
            {
                "id": contact,
                "company_id": company,
                "full_name": person,
                "email": email,
                "phone": phone,
            },
            lead=f"FU{n}",
        )
        api.call(
            f"{n}: the lead",
            "sales",
            "POST",
            "/leads",
            {"id": lead, "company_id": company, "contact_id": contact},
            lead=f"FU{n}",
        )
        for channel in ("email", "whatsapp"):
            api.call(
                f"{n}: consent for {channel}",
                "owner",
                "POST",
                f"/contacts/{contact}/record-consent",
                {
                    "channel": channel,
                    "status": "granted",
                    "basis": "explicit_consent",
                    "evidence_type": "web_form",
                    "evidence_ref": f"ref:fu{n}",
                },
                lead=f"FU{n}",
                replay=False,
            )
        # operator SQL (1): the lead is older than any touch of its history. The API refuses a touch older than its lead, and "five days ago" needs a lead that is at least that old.
        operator_sql(
            f"update public.leads set created_at = now() - interval '30 days' where id = '{lead}'"
        )
        made = Lead(key, lead, contact, company, email, phone)
        self.leads[key] = made
        self.facts.leads[key] = lead
        return made

    def touch(self, key: str, direction: str, ago: timedelta | None, n: int) -> None:
        body: dict[str, Any] = {
            "id": self.i(key, "touch", n),
            "direction": direction,
            "channel": "email",
        }
        if ago is not None:
            body["occurred_at"] = iso(
                self.now - ago
            )  # fixed once per run: a retry sends the same body
        self.api.call(
            f"{LEAD_NO[key]}: record touch {n} ({direction})",
            "sales",
            "POST",
            self.path(key, "/touches"),
            body,
            lead=f"FU{LEAD_NO[key]}",
        )

    def prepare_leads(self) -> None:
        for key in LEAD_KEYS:
            self.make_lead(key)
        self.touch("due_now", "out", timedelta(days=5), 1)
        self.touch("not_yet", "out", timedelta(hours=1), 1)
        self.touch("replied", "out", timedelta(days=5), 1)
        self.touch(
            "replied", "in", None, 2
        )  # the customer replied: "now" is the database's own clock
        self.touch("suppressed", "out", timedelta(days=5), 1)
        self.api.call(
            "4: the contact opts out",
            "sales",
            "POST",
            f"/contacts/{self.leads['suppressed'].contact_id}/suppress",
            {"reason": "opted_out", "evidence_type": "verbal", "evidence_ref": "call:fu4"},
            replay=False,
            lead="FU4",
        )
        self.touch("order_accepted", "out", timedelta(days=5), 1)
        for n, days in enumerate((6, 5, 4), start=1):
            self.touch("touch_limit", "out", timedelta(days=days), n)
        self.touch("reply_after_draft", "out", timedelta(days=5), 1)
        self.accepted_order()
        self.question_requirement()

    def legacy(self) -> Rehearsal:
        """The order rehearsal's own steps (enquiry, requirement, quote, approval, order), reused unchanged for the two leads that need them. Its ids are scoped by this run's tag."""
        if self._legacy is not None:
            return self._legacy
        legacy = Rehearsal(
            self.api,
            self.people,
            self.tenants,
            RunResult(label="followups", fresh=True, rec=self.rec),
        )
        legacy.leads = {
            900: {"lead_id": self.leads["order_accepted"].lead_id},
            901: {"lead_id": self.leads["questions"].lead_id},
        }
        self._legacy = legacy
        legacy.load_price_list()
        return legacy

    def accepted_order(self) -> None:
        """Lead 5: a quote approved, an order started and ACCEPTED by the customer, so follow-ups stop. The enquiry is the order rehearsal's E1 (its figures are hand-worked in tests/rehearsal/data)."""
        legacy = self.legacy()
        e1 = {**next(e for e in ENQUIRIES if e["key"] == "E1"), "lead_line": 900}
        legacy.enquiry_to_quote(e1)
        legacy.approve("Q1", "owner", "FU5")
        legacy.create_order("FU", "Q1", "owner", "FU5")
        self.order_id = legacy.order_id["FU"]
        for n, kind in enumerate(("send_quote", "customer_accept"), start=1):
            done = self.api.call(
                f"5: the order, {kind}",
                "sales",
                "POST",
                f"/orders/{self.order_id}/events",
                {
                    "id": self.i("event", n),
                    "type": kind,
                    "occurred_at": iso(legacy.day_start + timedelta(seconds=n)),
                },
                expect=(200,),
                lead="FU5",
            ).body
        self.rec.check("5: the order is accepted by the customer", "accepted", done["state"])

    def question_requirement(self) -> None:
        """Lead 8: an enquiry whose requirement is NOT confirmed and has a missing quantity (the order rehearsal's E8): clarifying questions can be stored for it."""
        legacy = self.legacy()
        e8 = {**next(e for e in ENQUIRIES if e["key"] == "E8"), "lead_line": 901}
        legacy.enquiry_to_quote(e8)
        eid = legacy.enquiry_id["E8"]
        seen = self.api.get(
            "8: open the requirement", "sales", f"/enquiries/{eid}/requirement", lead="FU8"
        ).body["requirement"]
        self.rec.check(
            "8: the requirement exists and is not confirmed",
            True,
            seen is not None and seen["status"] != "confirmed",
        )
        self.requirement_id = str(seen["id"])

    # ------------------------------------------------------------------------------ what a person finds right after the preparation
    def check_prepared(self) -> None:
        rec = self.rec
        now_ok = {"blocked": None, "stopped": None, "policy_in_force": True}
        one = self.read("due_now")
        rec.check("1 due now: nothing blocks and no one has stopped it", now_ok, one["gate"])
        d = one["decision"]
        rec.check(
            "1 due now: the rules say a draft can be made now (touch 2)",
            ("draft_followup", "eligible_now", 2),
            (d["action"], d["reason_code"], d["touch_number"]),
        )
        rec.check(
            "1 due now: one touch recorded, no draft yet",
            (1, 0),
            (len(one["touches"]), len(one["drafts"])),
        )
        two = self.read("not_yet")
        rec.check("2 not yet: the rules say wait", "wait", two["decision"]["action"])
        three = self.read("replied")
        rec.check(
            "3 replied: the rules stop and a person takes over",
            ("stop", "human_takeover"),
            (three["decision"]["action"], three["decision"]["reason_code"]),
        )
        four = self.read("suppressed")
        rec.check("4 suppressed: the gate names the contact", "contact", four["gate"]["blocked"])
        five = self.read("order_accepted")
        rec.check(
            "5 order accepted: follow-ups are stopped", "order_accepted", five["gate"]["stopped"]
        )
        d5 = five["decision"]
        rec.check(
            "5 order accepted: the page's answer is the stop, never 'a draft can be made now' (the engine does not know orders; the stop reason overrides it)",
            ("stop", "order_accepted", True, None),
            (d5["action"], d5["reason_code"], d5["terminal"], d5["touch_number"]),
        )
        six = self.read("no_first_touch")
        rec.check(
            "6 no first touch: nothing recorded, so the rules do not offer a draft",
            (0, False),
            (
                len(six["touches"]),
                six["decision"] is not None and six["decision"]["action"] == "draft_followup",
            ),
        )
        seven = self.read("touch_limit")
        rec.check(
            "7 touch limit: three touches recorded, the rules stop",
            (3, "stop"),
            (len(seven["touches"]), seven["decision"]["action"]),
        )
        nine = self.read("reply_after_draft")
        rec.check("9 reply after draft: due now", "draft_followup", nine["decision"]["action"])
        due = {
            x["lead_id"]: x
            for x in self.api.get("due list: as Sales", "sales", "/followups/due").body
        }
        for key, lead in self.leads.items():
            if lead.lead_id in due:
                x = due[lead.lead_id]
                self.facts.due[key] = (x["action"], x["reason_code"], x["touch_number"])
        self.read(
            "questions"
        )  # recorded for the report: the page of a lead that has only a requirement
        rec.check(
            "due list: lead 1 is due now",
            "draft_followup",
            due[self.leads["due_now"].lead_id]["action"],
        )
        rec.check(
            "due list: lead 2 is not yet", "wait", due[self.leads["not_yet"].lead_id]["action"]
        )
        rec.check(
            "due list: lead 3 is stopped (replied)",
            "stop",
            due[self.leads["replied"].lead_id]["action"],
        )
        rec.check(
            "due list: lead 7 is stopped (limit)",
            "stop",
            due[self.leads["touch_limit"].lead_id]["action"],
        )
        rec.check(
            "due list: lead 5 (order accepted) is not listed: a stopped lead is never due",
            False,
            self.leads["order_accepted"].lead_id in due,
        )
        rec.check(
            "due list: a lead with no recorded first message is not listed",
            False,
            self.leads["no_first_touch"].lead_id in due,
        )
        rec.check(
            "due list: a lead with no touch and a requirement only is not listed",
            False,
            self.leads["questions"].lead_id in due,
        )
        self.keyed()

    def keyed(self) -> None:
        """Counts only: every contact of this workspace has both suppression keys. The API computed them when it created each contact (the rehearsal gives the in-process API a synthetic key, never a real one)."""
        t = self.tenant
        contacts = int(
            operator_sql(f"select count(*) from public.contacts where tenant_id = '{t}'")
        )  # operator SQL (2): counts
        keyed = int(
            operator_sql(
                f"select count(*) from suppression.contact_keys where tenant_id = '{t}' and email_hmac is not null and phone_hmac is not null"
            )
        )
        self.rec.check(
            "every prepared contact is keyed for e-mail and phone (counts)",
            (len(LEAD_KEYS), len(LEAD_KEYS)),
            (contacts, keyed),
        )

    # ------------------------------------------------------------------------------ the journey
    def journey(self, client: TestClient, guard: NetworkGuard) -> None:
        self.viewer_sees_nothing()
        self.happy_path()
        self.refusals()
        self.stale_after_reply()
        self.questions()
        self.nothing_was_sent(client, guard)

    def viewer_sees_nothing(self) -> None:
        any_lead = self.leads["due_now"].lead_id
        for step, method, path, body in (
            ("a Viewer opens a lead's follow-up page", "GET", f"/leads/{any_lead}/followup", None),
            ("a Viewer opens the due list", "GET", "/followups/due", None),
            ("a Viewer lists the drafts", "GET", "/followup-drafts", None),
            (
                "a Viewer opens the questions",
                "GET",
                f"/requirements/{self.requirement_id}/question-drafts",
                None,
            ),
            (
                "a Viewer tries to record a touch",
                "POST",
                f"/leads/{any_lead}/touches",
                {"id": self.i("viewer", "touch"), "direction": "out", "channel": "email"},
            ),
            (
                "a Viewer tries to ask for a draft",
                "POST",
                f"/leads/{any_lead}/followup-drafts",
                {"id": self.i("viewer", "draft"), "channel": "email"},
            ),
        ):
            self.refuse(f"viewer: {step}", "viewer", method, path, body, 403, "forbidden")

    def happy_path(self) -> None:
        api, rec = self.api, self.rec
        lead = self.leads["due_now"].lead_id
        draft = self.i("due_now", "draft", 1)
        made = api.call(
            "1: Sales asks for a draft (the channel only)",
            "sales",
            "POST",
            f"/leads/{lead}/followup-drafts",
            {"id": draft, "channel": "email"},
            expect=(200, 201),
            lead="FU1",
        ).body
        rec.check(
            "1: a draft for touch 2, waiting for approval",
            (2, "draft"),
            (made["touch_number"], made["status"]),
        )
        shown = api.get("1: read the draft", "sales", f"/followup-drafts/{draft}", lead="FU1").body
        self.facts.texts["followup_draft"] = shown["body"]
        rec.check(
            "1: the draft is a closed template with a fingerprint",
            (True, True, "draft"),
            (
                len(shown["body"]) > 20,
                bool(re.fullmatch(r"[0-9a-f]{64}", shown["state_hash"])),
                shown["status"],
            ),
        )
        rec.check("1: it was made by Sales", self.people.ids["sales"], shown["created_by"])
        self.refuse(
            "1: Sales tries to approve",
            "sales",
            "POST",
            f"/followup-drafts/{draft}/approve",
            {"state_hash": shown["state_hash"]},
            403,
            "forbidden",
        )
        self.refuse(
            "1: an Admin without the authenticator code tries to approve",
            "admin",
            "POST",
            f"/followup-drafts/{draft}/approve",
            {"state_hash": shown["state_hash"]},
            403,
            "mfa_required",
            weak=True,
        )
        self.refuse(
            "1: an Admin approves a text other than the one shown (a wrong fingerprint)",
            "admin",
            "POST",
            f"/followup-drafts/{draft}/approve",
            {"state_hash": "0" * 64},
            409,
            "followup_stale",
        )
        approved = api.call(
            "1: an Admin approves the text that was shown",
            "admin",
            "POST",
            f"/followup-drafts/{draft}/approve",
            {"state_hash": shown["state_hash"]},
            expect=(200,),
            lead="FU1",
        ).body
        rec.check("1: approved", "approved", approved["status"])
        touch = self.i("due_now", "touch", 2)
        sent = api.call(
            "1: Sales records 'I sent it myself'",
            "sales",
            "POST",
            f"/followup-drafts/{draft}/sent",
            {"touch_id": touch},
            expect=(200, 201),
            lead="FU1",
        ).body
        rec.check(
            "1: recorded as sent, by a person's word",
            ("recorded_sent", touch),
            (sent["status"], sent["touch_id"]),
        )
        page = self.read("due_now")
        rec.check(
            "1: the lead page shows touch 2 recorded",
            (2, "out"),
            (len(page["touches"]), page["touches"][0]["direction"]),
        )
        rec.check(
            "1: the draft is recorded as sent",
            ["recorded_sent"],
            [x["status"] for x in page["drafts"]],
        )
        rec.check(
            "1: the touch was recorded by Sales and names the draft",
            (self.people.ids["sales"], draft),
            (page["touches"][0]["recorded_by"], page["touches"][0]["draft_id"]),
        )
        d = page["decision"]
        rec.check(
            "1: the next follow-up is not yet due", ("wait", False), (d["action"], d["terminal"])
        )
        self.refuse(
            "1: Sales asks for another draft straight away",
            "sales",
            "POST",
            f"/leads/{lead}/followup-drafts",
            {"id": self.i("due_now", "draft", 2), "channel": "email"},
            409,
            "not_due",
            "not_yet",
        )
        self.refuse(
            "1: a second 'I sent it' for a recorded draft",
            "sales",
            "POST",
            f"/followup-drafts/{draft}/sent",
            {"touch_id": self.i("due_now", "touch", 3)},
            409,
            "draft_state",
            "closed",
        )

    def refusals(self) -> None:
        """Each lead of the checklist that is not due, refused for its own closed reason: (key, what a person did, status, code, reason)."""
        table: tuple[tuple[str, str, int, str, str], ...] = (
            (
                "not_yet",
                "2 not yet: Sales asks for a draft one hour after the last touch",
                409,
                "not_due",
                "not_yet",
            ),
            (
                "replied",
                "3 replied: Sales asks for a draft after the customer replied",
                409,
                "not_due",
                "replied",
            ),
            (
                "suppressed",
                "4 suppressed: Sales asks for a draft for a contact who opted out",
                409,
                "contact_blocked",
                "contact",
            ),
            (
                "order_accepted",
                "5 order accepted: Sales asks for a draft after the customer accepted",
                409,
                "followup_stopped",
                "order_accepted",
            ),
            (
                "no_first_touch",
                "6 no first touch: Sales asks for a follow-up before any first message",
                409,
                "not_due",
                "initial_outreach",
            ),
            (
                "touch_limit",
                "7 touch limit: Sales asks for a fourth touch",
                409,
                "not_due",
                "max_touches",
            ),
        )
        for key, step, status, code, reason in table:
            body = {"id": self.i(key, "draft", 1), "channel": "email"}
            self.refuse(
                step,
                "sales",
                "POST",
                self.path(key, "/followup-drafts"),
                body,
                status,
                code,
                reason,
            )
        # the same refusals as the owner meets them on the lead pages: the page's gate says it before anyone asks
        self.rec.check(
            "4 suppressed: the page's gate says 'contact'",
            "contact",
            self.read("suppressed")["gate"]["blocked"],
        )
        self.rec.check(
            "5 order accepted: the page says follow-ups are stopped",
            "order_accepted",
            self.read("order_accepted")["gate"]["stopped"],
        )

    def stale_after_reply(self) -> None:
        api, rec = self.api, self.rec
        lead = self.leads["reply_after_draft"].lead_id
        draft = self.i("reply_after_draft", "draft", 1)
        made = api.call(
            "9: Sales asks for a draft",
            "sales",
            "POST",
            f"/leads/{lead}/followup-drafts",
            {"id": draft, "channel": "email"},
            expect=(200, 201),
            lead="FU9",
        ).body
        held = api.get(
            "9: the Admin reads the draft (the fingerprint they would approve)",
            "admin",
            f"/followup-drafts/{draft}",
            lead="FU9",
        ).body
        rec.check("9: a draft is waiting", ("draft", 2), (made["status"], made["touch_number"]))
        api.call(
            "9: Sales records that the customer replied",
            "sales",
            "POST",
            f"/leads/{lead}/touches",
            {"id": self.i("reply_after_draft", "touch", 2), "direction": "in", "channel": "email"},
            expect=(200, 201),
            lead="FU9",
        )
        after = api.get(
            "9: read the draft again", "admin", f"/followup-drafts/{draft}", lead="FU9"
        ).body
        rec.check(
            "9: the draft was discarded because the customer replied",
            ("discarded", "reply_recorded"),
            (after["status"], after["discard_code"]),
        )
        self.refuse(
            "9: the Admin tries to approve the text they had reviewed",
            "admin",
            "POST",
            f"/followup-drafts/{draft}/approve",
            {"state_hash": held["state_hash"]},
            409,
            "draft_state",
            "not_draft",
        )
        self.refuse(
            "9: Sales asks for a new draft after the reply",
            "sales",
            "POST",
            f"/leads/{lead}/followup-drafts",
            {"id": self.i("reply_after_draft", "draft", 2), "channel": "email"},
            409,
            "not_due",
            "replied",
        )

    def questions(self) -> None:
        api, rec = self.api, self.rec
        base = f"/requirements/{self.requirement_id}"
        synced = api.call(
            "8: Sales stores the clarifying questions",
            "sales",
            "POST",
            f"{base}/question-drafts/sync",
            None,
            expect=(200, 201),
            lead="FU8",
            replay=True,
        ).body
        drafts = synced["drafts"]
        rec.check(
            "8: at least one question is stored, each a draft",
            (True, True),
            (len(drafts) >= 1, all(q["status"] == "draft" for q in drafts)),
        )
        for n, q in enumerate(drafts, start=1):
            self.facts.texts[f"question {n} of {len(drafts)}"] = q["question_text"]
        again = api.call(
            "8: storing again changes nothing",
            "sales",
            "POST",
            f"{base}/question-drafts/sync",
            None,
            expect=(200, 201),
            lead="FU8",
            replay=False,
        ).body
        rec.check("8: a second sync changes nothing", 0, again["changed"])
        first = drafts[0]["id"]
        done = api.call(
            "8: Sales approves a question",
            "sales",
            "POST",
            f"/question-drafts/{first}/approve",
            None,
            expect=(200,),
            lead="FU8",
        ).body
        rec.check("8: approved", "approved", done["status"])
        gone = api.call(
            "8: Sales discards it",
            "sales",
            "POST",
            f"/question-drafts/{first}/discard",
            None,
            expect=(200,),
            lead="FU8",
        ).body
        rec.check("8: discarded", "discarded", gone["status"])
        self.refuse(
            "8: approving a discarded question",
            "sales",
            "POST",
            f"/question-drafts/{first}/approve",
            None,
            409,
            "draft_state",
            "closed",
        )
        listed = api.get(
            "8: list the active questions",
            "sales",
            f"{base}/question-drafts?active_only=true",
            lead="FU8",
        ).body
        rec.check(
            "8: the discarded question is not active", False, any(q["id"] == first for q in listed)
        )

    # ------------------------------------------------------------------------------ nothing was sent, and nothing could have been
    def nothing_was_sent(
        self, client: TestClient | None = None, guard: NetworkGuard | None = None
    ) -> None:
        rec = self.rec
        # (1) no setting names a message provider, and the follow-up code imports none
        names = sorted(Settings.model_fields)
        senders = re.compile(
            r"smtp|mail|sendgrid|twilio|whatsapp|sms|webhook|postmark|resend|msg91|gupshup", re.I
        )
        rec.check(
            "nothing could send: no setting names a message provider",
            [],
            [n for n in names if senders.search(n)],
        )
        imports = re.compile(
            r"^\s*(?:import|from)\s+(smtplib|aiosmtplib|twilio|sendgrid|boto3|slack_sdk|requests)\b",
            re.M,
        )
        hits = [
            f.name
            for f in (API_DIR / "app" / "followups").glob("*.py")
            if imports.search(f.read_text())
        ]
        rec.check(
            "nothing could send: the follow-up code imports no mail or messaging library", [], hits
        )
        # (2) the routes: the only path with 'sent' records a person's word; none is called send; no body carries wording, a contact or an address
        if client is not None:
            spec = client.app.openapi()  # type: ignore[attr-defined]
            paths: dict[str, Any] = spec["paths"]
            mine = {
                p: m
                for p, m in paths.items()
                if re.search(
                    r"followup|touches|question-drafts|requirements/\{[a-z_]+\}/question", p
                )
            }
            rec.check(
                "nothing could send: no follow-up route is called send",
                [],
                [p for p in mine if re.search(r"/send(?:/|$)", p)],
            )
            allowed = {
                "/v1/tenants/{tenant_id}/leads/{lead_id}/touches": {
                    "id",
                    "direction",
                    "channel",
                    "occurred_at",
                },
                "/v1/tenants/{tenant_id}/leads/{lead_id}/followup-drafts": {"id", "channel"},
                "/v1/tenants/{tenant_id}/followup-drafts/{draft_id}/approve": {"state_hash"},
                "/v1/tenants/{tenant_id}/followup-drafts/{draft_id}/sent": {
                    "touch_id",
                    "occurred_at",
                },
                "/v1/tenants/{tenant_id}/followup-policy-versions": {
                    "id",
                    "effective_from",
                    "gap_days",
                    "max_touches",
                    "quiet_start",
                    "quiet_end",
                    "allowed_weekdays",
                    "holidays",
                    "min_gap_hours",
                    "recipient_utc_offset_minutes",
                },
            }
            for path, want in allowed.items():
                schema = paths[path]["post"]["requestBody"]["content"]["application/json"]["schema"]
                ref = schema["$ref"].rsplit("/", 1)[1]
                got = set(spec["components"]["schemas"][ref]["properties"])
                rec.check(
                    f"nothing could send: {path.split('{tenant_id}')[1]} accepts only {sorted(want)}",
                    sorted(want),
                    sorted(got),
                )
        # (3) the database: no outbox of any kind, and every recorded draft has a person's touch
        t = self.tenant
        tables = operator_sql(
            "select count(*) from information_schema.tables where table_schema in ('public', 'suppression', 'app') and table_name ~* '(outbox|email_queue|send_queue|sent_message|delivery|smtp)'"
        )
        rec.check("nothing could send: no outbox or delivery table exists", "0", tables)
        orphans = operator_sql(
            f"select count(*) from public.followup_drafts d where d.tenant_id = '{t}' and d.status = 'recorded_sent' and not exists (select 1 from public.lead_touches x where x.draft_id = d.id and x.direction = 'out' and x.recorded_by is not null)"
        )
        rec.check("every draft recorded as sent is a person's recorded touch", "0", orphans)
        # (4) the network: only the local stack was touched (the in-process API makes no other connection)
        if guard is not None:
            rec.check("no connection but the local stack", [], guard.refused)
            ports = sorted({k.rsplit(":", 1)[1] for k in guard.local})
            rec.check(
                "only the local stack's port was used",
                [str(Stack.from_env().url.rsplit(":", 1)[1])],
                ports,
            )


def tag_now() -> str:
    return datetime.now(UTC).strftime("%m%d%H%M%S")


def provision(api_boot: Api, people: People, stack: Stack, slug: str, name: str) -> str:
    """The workspace: made by the Owner through the API; the three other people are added the way the order rehearsal does it (the API has no invite route yet: the Owner adds a member through the database API with their own token); the synthetic reference data is seeded (products and policies; the price list comes from the CSV)."""
    made = api_boot.call(
        "workspace: create",
        "owner",
        "POST",
        "/v1/tenants",
        {"name": name, "slug": slug},
        replay=False,
    )
    tenant_id = str(made.body["id"])
    for role in ("admin", "sales", "viewer"):
        added = stack.pg(
            people.tokens["owner"]["aal2"],
            "POST",
            "/memberships",
            json={"tenant_id": tenant_id, "user_id": people.ids[role], "role": role},
        )
        if added.status_code != 201:
            raise SystemExit(f"could not add the {role}: {added.status_code}")
    seeded = subprocess.run(
        [
            sys.executable,
            "seeds/seed_quote_reference_data.py",
            "--tenant-slug",
            slug,
            "--without-price-list",
        ],
        cwd=API_DIR,
        capture_output=True,
        text=True,
        timeout=90,
    )
    if seeded.returncode != 0:
        raise SystemExit(
            "the synthetic reference data could not be seeded: " + seeded.stderr.strip()[:200]
        )
    return tenant_id


def main(argv: list[str]) -> int:
    prepare_only = "--prepare-only" in argv
    stack = Stack.from_env()
    if any("SERVICE_ROLE" in k.upper() for k in os.environ):
        raise SystemExit(
            "refusing: a service-role value is in the environment; the rehearsal needs only the public URL and key"
        )
    started = time.perf_counter()
    tag = tag_now()
    harness.ID_SCOPE = f"fu-{tag}"
    now = datetime.now(UTC).replace(microsecond=0)
    guard = NetworkGuard()
    settings = Settings(
        _env_file=None,
        api_env="development",
        supabase_url=stack.url,
        supabase_anon_key=stack.anon_key,
        suppression_hmac_key=SecretStr(SYNTHETIC_KEY),
    )  # type: ignore[call-arg]
    rec = Recorder()
    stopped: str | None = None
    with guard, TestClient(create_app(settings)) as client:
        people = People(stack)
        prepare(people)
        boot = Api(client, people, {}, rec)
        slug = f"rehearsal-fu-{tag}"
        tenant_id = provision(boot, people, stack, slug, f"Follow-up rehearsal {tag}")
        run = FollowupRehearsal(
            Api(client, people, {"a": tenant_id}, rec),
            people,
            {"a": tenant_id},
            rec,
            stack,
            tag,
            now,
        )
        try:
            run.policy()
            run.prepare_leads()
            run.check_prepared()
            if not prepare_only:
                run.journey(client, guard)
        except Deviation as exc:
            stopped = str(exc)
        seconds = time.perf_counter() - started
    failed = rec.failed()
    if prepare_only:
        return ready_to_click(run, people, failed, stopped)
    write_follow_report(run, rec, seconds, stopped)
    print(
        f"follow-up rehearsal: {'STOPPED' if stopped else 'ran'}; checks {len(rec.checks) - len(failed)}/{len(rec.checks)} passed; refusals reached: {len(run.facts.sentences)}; report: {REPORT}"
    )
    if stopped:
        print("stopped at: " + stopped)
    for c in failed[:20]:
        print(f"FAILED: {c.name}: expected {c.expected!r}, got {c.actual!r}")
    return 1 if (failed or stopped) else 0


def ready_to_click(
    run: FollowupRehearsal, people: People, failed: list[Any], stopped: str | None
) -> int:
    print(
        f"follow-up rehearsal (prepare for clicking): {'STOPPED: ' + stopped if stopped else 'ready'}; checks failed: {len(failed)}"
    )
    for c in failed[:10]:
        print(f"FAILED: {c.name}: expected {c.expected!r}, got {c.actual!r}")
    t = run.tenant
    print(
        f"Workspace: http://localhost:3000/app/tenants/{t}  (sign in at http://localhost:3000/login)"
    )
    print(f"Follow-ups due: http://localhost:3000/app/tenants/{t}/followups")
    for key in LEAD_KEYS:
        print(
            f"  lead {LEAD_NO[key]} {LEAD_SPEC[key][0]:30} http://localhost:3000/app/tenants/{t}/leads/{run.facts.leads[key]}/followup"
        )
    print(
        f"  requirement of lead 8 (questions): http://localhost:3000/app/tenants/{t}/requirements/{run.requirement_id}/questions"
    )
    for role in ("owner", "admin", "sales", "viewer"):
        user = people.state["users"]["rehearsal-" + role]
        print(
            f"  {role:7} {user['email']}  password: {user['password']}  authenticator key: {user['totp_secret']}"
        )
    print(
        "Add each authenticator key to an authenticator app by hand (enter the key; 6 digits, 30 seconds, SHA-1). Use one private window per person."
    )
    print(
        "Start the servers with `make dev-api` and `make dev-web`. The policy's recipient clock reads about noon NOW: do the checklist within a few hours, or prepare again."
    )
    print(
        f"Optional: to have contacts you create by hand keyed too, start the API as `SUPPRESSION_HMAC_KEY={SYNTHETIC_KEY} make dev-api` (a synthetic, non-secret key). The prepared contacts are already keyed."
    )
    return 1 if (failed or stopped) else 0


def write_follow_report(
    run: FollowupRehearsal, rec: Recorder, seconds: float, stopped: str | None
) -> None:
    failed = rec.failed()
    verdict = "STOPPED" if stopped else ("FAILED" if failed else "PASSED")
    calls = rec.calls
    out: list[str] = []
    w = out.append
    w("# Follow-up rehearsal: report")
    w("")
    w(
        f"Written {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')} by `make rehearse-followups`. **Everything here is synthetic and local**: invented people, the local stack, no model, nothing sent to anyone."
    )
    w("")
    w(
        f"**Verdict: {verdict}.** {len(rec.checks) - len(failed)}/{len(rec.checks)} checks passed; {len(calls)} API calls in {seconds:.1f} s; workspace `{run.tenant}` (run `{run.tag}`)."
    )
    if stopped:
        w("")
        w(f"Stopped at: {stopped}")
    w("")
    w(
        "## Refusals reached (status, closed code, closed reason; the screens show our sentence for each)"
    )
    w("")
    w("| Step | Status | Code | Reason |")
    w("| --- | --- | --- | --- |")
    for step, status, code, reason in run.facts.sentences:
        w(f"| {step} | {status} | {code or ''} | {reason or ''} |")
    w("")
    w("## What each lead showed right after the preparation (the checklist quotes these)")
    w("")
    w(
        "| Lead | Blocked by | Stopped by | Rules' answer (action, reason, touch) | In the due list as |"
    )
    w("| --- | --- | --- | --- | --- |")
    for key in LEAD_KEYS:
        page = run.facts.pages.get(key)
        if page is None:
            continue
        d = page["decision"]
        said = (
            "none" if d is None else f"{d['action']}, {d['reason_code']}, touch {d['touch_number']}"
        )
        listed = run.facts.due.get(key)
        w(
            f"| {LEAD_NO[key]} {LEAD_SPEC[key][0]} | {page['gate']['blocked'] or ''} | {page['gate']['stopped'] or ''} | {said} | {'not listed' if listed is None else f'{listed[0]}, {listed[1]}, touch {listed[2]}'} |"
        )
    w("")
    w("## The closed texts a person copies (read from the run)")
    w("")
    for name, text in run.facts.texts.items():
        w(f"* **{name}**: `{text}`")
    w("")
    w("## Checks")
    w("")
    w("| Check | Expected | Got | |")
    w("| --- | --- | --- | --- |")
    for c in rec.checks:
        w(
            f"| {c.name} | `{json.dumps(c.expected, default=str)}` | `{json.dumps(c.actual, default=str)}` | {'ok' if c.ok else '**FAILED**'} |"
        )
    REPORT.write_text("\n".join(out) + "\n")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
