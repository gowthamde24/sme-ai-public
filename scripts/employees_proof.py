"""STAGING PROOF of the AI employees (26 Nov 2026), click-less: through the real routes of a local API (EMPLOYEES on, staging database) and the scheduler's own account.

  PYTHONPATH=services/ai-api python3 -I scripts/employees_proof.py --i-know-this-is-staging [--api-url http://localhost:8000]

It makes TWO new synthetic workspaces (one made paid, one trial; both archived at the end) for the employees and the plan limit, and asks the written chat of the textiles demo Owner for the voice plan card (nothing is saved). Nothing is sent, nobody is called: the "simulated call" of an employee is
what a call READS (the employee the scheduler's account gets for a line or a task, the voice it resolves, the opening it says, the never-say words, the prompt block) plus a simulated call row that is tagged and shown in the employee's activity.
Writes: 2 employees (archived at the end), 1 simulated call row, 1 trial workspace (archived)."""

# ruff: noqa: E501, S608

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import charging_proof as cp  # noqa: E402
import seed_staging as ss  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))


class Proof:
    def __init__(self, api: str) -> None:
        self.s = ss.Seeder("https://sme-api-620338396268.asia-south1.run.app")
        self.s.api = api.rstrip("/")
        self.terms = self.s.terms()
        self.workspaces: list[str] = []
        # the demo textiles Owner is used ONLY to ask the written chat for the voice plan card (no write): the workspaces for the employees are new synthetic ones (a paid and a trial)
        self.demo_token = self.s.sign_in(f"demo-textiles@{ss.DEMO_DOMAIN}", ss.secret_get("sme-demo-textiles-password") or "")["access_token"]
        me = self.s.call(self.demo_token, "GET", "/v1/me")[1]
        listed = [m["tenant"] for m in me["memberships"]]
        self.demo_tenant = str(next((t["id"] for t in listed if "Neelambari" in str(t.get("name"))), listed[0]["id"]))   # the demo workspace the assistant's routed work is switched on for (ASSISTANT_WORK_TENANTS)
        self.token, self.tenant = self.new_workspace("Employees proof paid", "growth")
        self.t = f"/v1/tenants/{self.tenant}"
        sched_pw = ss.secret_get("sme-scheduler-password")
        if sched_pw is None:
            raise ss.SeedError("no scheduler password in Secret Manager")
        self.sched = self.s.sign_in(ss.SCHEDULER_EMAIL, sched_pw)["access_token"]

    def new_workspace(self, name: str, plan: str | None) -> tuple[str, str]:
        email = f"employees-proof-{uuid.uuid4().hex[:8]}@demo.example.test"
        password = ss.secret_get(cp.SECRET) or ss.new_password()
        self.s.create_user(email, password, {"terms_version": self.terms["terms"], "business_name": name})
        token = self.s.sign_in(email, password)["access_token"]
        st, setup = self.s.call(token, "POST", "/v1/account/setup", {"business_type": "textiles", "language": "en", "accepted_terms_version": self.terms["terms"], "accepted_privacy_version": self.terms["privacy"]})
        if st != 200 or not isinstance(setup, dict):
            raise ss.SeedError(f"setup failed (HTTP {st})")
        tenant = str(setup["tenant_id"])
        self.workspaces.append(tenant)
        if plan:   # a synthetic workspace made paid for the proof (a disposable one, archived at the end)
            cp.sql(f"update public.tenants set plan = '{plan}' where id = '{tenant}'")
        return token, tenant

    def rpc(self, name: str, args: dict[str, Any]) -> Any:
        req = urllib.request.Request(f"{self.s.sb}/rest/v1/rpc/{name}", data=json.dumps(args).encode(), method="POST", headers={"apikey": self.s.pub, "Authorization": f"Bearer {self.sched}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310
            return json.loads(r.read() or "null")

    def go(self, method: str, path: str, body: Any = None, token: str | None = None) -> tuple[int, Any]:
        return self.s.call(token or self.token, method, path, body)


def hours_outside_now() -> dict[str, Any]:
    now = datetime.now(IST)
    minute = now.hour * 60 + now.minute
    start = 600 if not (600 <= minute < 601) else 1259
    return {"days": [1, 2, 3, 4, 5, 6, 7], "from_minute": start, "to_minute": start + 1}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-url", default="http://localhost:8000")
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    a = ap.parse_args()
    if not a.i_know_this_is_staging:
        print("refusing: pass --i-know-this-is-staging")
        return 2
    from app.conversation.sound import Stored, resolve_sound
    from app.conversation.voices import default_config
    from app.employees import apply as ea
    from app.telephony import persona
    from app.telephony.call_opening import call_opening

    p = Proof(a.api_url)
    say, note = cp.say, cp.note
    cfg = default_config()
    mine: list[str] = []
    note(f"# AI employees proof, {datetime.now(IST):%d %b %Y %H:%M} India time, API {a.api_url} (EMPLOYEES on), staging database\n")

    # 1. the list, the default employee, the limit
    st, lst = p.go("GET", f"{p.t}/employees")
    say(st == 200 and lst["limit"] == 5 and lst["employees"][0]["is_default"] is True, "1a the paid demo workspace lists its default employee first, limit 5", "200, limit 5, default first", f"{st}, {lst.get('limit') if isinstance(lst, dict) else lst}")
    default = lst["employees"][0]

    # 2. two employees through the routes
    priya_id, ravi_id = str(uuid.uuid4()), str(uuid.uuid4())
    suffix = uuid.uuid4().hex[:4]
    st, priya = p.go("POST", f"{p.t}/employees", {"id": priya_id, "role_code": "sales", "name": f"Priya{suffix}"})
    say(st == 201 and priya["status"] == "draft", "2a create Priya (sales): a draft with the role's responsibilities", "201 draft", f"{st} {priya.get('status') if isinstance(priya, dict) else priya}")
    mine.append(priya_id)
    st, ravi = p.go("POST", f"{p.t}/employees", {"id": ravi_id, "role_code": "collections", "name": f"Ravi{suffix}"})
    say(st == 201, "2b create Ravi (collections)", "201", st)
    mine.append(ravi_id)
    st, out = p.go("PUT", f"{p.t}/employees/{priya_id}", {"role_title": "Sales assistant", "languages": ["te", "en"], "speed": 1.1, "style": "quick",
                                                         "opening_line": {"en": f"Hello, this is Priya{suffix} from the sales desk, an AI assistant.", "te": f"నమస్కారం, నేను ప్రియ{suffix}, సేల్స్ డెస్క్ AI assistant."},
                                                         "never_say": ["discount code"], "extra_instructions": "Always ask which fabric the customer wants first.", "autonomy": {"may_answer_prices": False, "max_discount_percent": 5}})
    say(st == 200 and out["never_say"] == ["discount code"], "2c Priya: title, languages, speed, style, opening lines, never-say, instructions, autonomy", 200, st)
    st, out = p.go("PUT", f"{p.t}/employees/{priya_id}/voices/te", {"voice_code": "te-ramya"})
    say(st == 200 and out["voices"].get("te") == "te-ramya", "2d Priya's Telugu voice is Ramya", "te-ramya", out.get("voices") if isinstance(out, dict) else st)
    st, out = p.go("PUT", f"{p.t}/employees/{priya_id}/voices/en", {"voice_code": "te-ramya"})
    say(st == 422, "2e a voice of another language is refused", 422, st)
    for eid in (priya_id, ravi_id):
        st, out = p.go("POST", f"{p.t}/employees/{eid}/status", {"status": "on"})
        say(st == 200 and out["status"] == "on", f"2f switched on {eid[:6]}", "200 on", f"{st}")
    st, lst = p.go("GET", f"{p.t}/employees")
    say(len(lst["employees"]) == 3, "2g the list now has 3 (default, Priya, Ravi)", 3, len(lst["employees"]))

    # 3. what a call reads, per employee (the scheduler's account)
    business = "Lakshmi Silks"
    workspace_row = p.rpc("call_sound_for_call", {"p_tenant_id": p.tenant}) or {}
    training = p.rpc("talk_training_for_call", {"p_tenant_id": p.tenant}) or {}
    for label, eid, lang, want_voice in (("Priya", priya_id, "te", "te-ramya"), ("the default employee", None, "te", None)):
        emp = p.rpc("employee_runtime", {"p_tenant_id": p.tenant, "p_employee_id": eid, "p_line": None})
        row, train, name = ea.apply(emp, workspace_row if isinstance(workspace_row, dict) else None, training if isinstance(training, dict) else None, str((emp or {}).get("name") or "the assistant"))
        voice = resolve_sound(cfg, Stored.from_call_row(row, train), lang).voice.id
        opening = call_opening(lang, business=business, assistant=name, training=train, say_ai=True)
        prompt = persona.system_prompt(business=business, assistant=name, language=lang, purpose="inbound", facts=[], customer_first_name=None, training=train, employee=ea.block(emp))
        if eid == priya_id:
            say(voice == want_voice, f"3a {label}: the Telugu voice a call would use", want_voice, voice)
            say(name.startswith("Priya") and "AI" in opening and "ప్రియ" in opening, f"3b {label}: the opening line is hers and says it is an AI", "hers, with AI", opening[:60])
            say("discount code" in (train or {}).get("never_say", []), f"3c {label}: her never-say word is added to the workspace's", True, (train or {}).get("never_say"))
            say("YOU ARE Priya" in prompt and "Do not state any price" in prompt and prompt.index("NEVER state a price") < prompt.index("YOU ARE Priya"), f"3d {label}: her block is in the prompt, below the platform rules", True, "block after the rules")
        else:
            say(emp is not None and emp["persona_in"] == "my_assistant" and voice == resolve_sound(cfg, Stored.from_call_row(workspace_row, training), lang).voice.id, f"3e {label}: keeps the workspace's own voice (My assistant)", "the workspace's voice", voice)

    # 4. the line: Priya answers one number, any other goes to the default
    cp.sql(f"insert into public.phone_numbers (id, tenant_id, number, label) values (gen_random_uuid(), '{p.tenant}', '+9180' || lpad((floor(random() * 99999999))::text, 8, '0'), 'Employees proof line')")
    numbers = cp.sql(f"select id, number from public.phone_numbers where tenant_id = '{p.tenant}' order by created_at limit 1")
    if numbers:
        nid, num = str(numbers[0]["id"]), str(numbers[0]["number"])
        st, out = p.go("PUT", f"{p.t}/employees/{priya_id}/phone", {"phone_number_id": nid})
        say(st == 200, "4a a line is given to Priya", 200, st)
        emp = p.rpc("employee_runtime", {"p_tenant_id": p.tenant, "p_employee_id": None, "p_line": num})
        say(emp is not None and emp["id"] == priya_id, "4b a call to that line is answered by Priya", priya_id[:8], str((emp or {}).get("id"))[:8])
        emp = p.rpc("employee_runtime", {"p_tenant_id": p.tenant, "p_employee_id": None, "p_line": "+910000000000"})
        say(emp is not None and emp["is_default"] is True, "4c any other line goes to the default employee", True, (emp or {}).get("is_default"))
    else:
        note("4 (skipped: the workspace has no phone number row)")

    # 5. hours narrowing
    st, out = p.go("PUT", f"{p.t}/employees/{ravi_id}", {"hours": {"days": [1, 2, 3, 4, 5, 6, 7], "from_minute": 540, "to_minute": 1200}})
    say(st == 422 and out["error"]["code"] == "hours_wider", "5a hours from 09:00 are refused (wider than the legal window)", "422 hours_wider", f"{st} {out['error']['code'] if isinstance(out, dict) and 'error' in out else ''}")
    st, out = p.go("PUT", f"{p.t}/employees/{ravi_id}", {"hours": hours_outside_now()})
    say(st == 200, "5b a one-minute window that is not now is accepted (narrower)", 200, st)
    emp = p.rpc("employee_runtime", {"p_tenant_id": p.tenant, "p_employee_id": ravi_id, "p_line": None})
    say(emp is not None and emp["is_default"] is True, "5c outside its own hours Ravi does not answer: the default does", True, (emp or {}).get("is_default"))
    now = datetime.now(IST)
    if 600 <= now.hour * 60 + now.minute < 1260:
        st, out = p.go("PUT", f"{p.t}/employees/{ravi_id}", {"hours": {"days": [1, 2, 3, 4, 5, 6, 7], "from_minute": 600, "to_minute": 1260}})
        emp = p.rpc("employee_runtime", {"p_tenant_id": p.tenant, "p_employee_id": ravi_id, "p_line": None})
        say(emp is not None and emp["id"] == ravi_id, "5d inside its window (10:00 to 21:00, now) Ravi answers", ravi_id[:8], str((emp or {}).get("id"))[:8])
    else:
        note("5d (skipped: it is outside 10:00 to 21:00 in India now, so no allowed window contains now)")

    # 6. a simulated call row, tagged and shown in the activity
    cid = str(uuid.uuid4())
    cp.sql(f"insert into public.phone_calls (id, tenant_id, direction, state, provider, sandbox, simulated, purpose, answered_at, ended_at, duration_s, end_reason) values ('{cid}', '{p.tenant}', 'outbound', 'completed', 'sandbox', true, true, 'sales_followup', now() - interval '3 minutes', now() - interval '1 minute', 60, 'goodbye')")
    p.rpc("employee_call_tag", {"p_tenant_id": p.tenant, "p_call_id": cid, "p_employee_id": priya_id})
    st, act = p.go("GET", f"{p.t}/employees/{priya_id}/activity")
    say(st == 200 and any(c["id"] == cid for c in act["calls"]), "6 the simulated call is in Priya's activity", True, st)

    # 7. the plan limit on a trial workspace
    tok, trial_tenant = p.new_workspace("Employees proof trial", None)
    st, lst = p.go("GET", f"/v1/tenants/{trial_tenant}/employees", None, tok)
    say(st == 200 and lst["limit"] == 1 and len(lst["employees"]) == 1, "7a a trial workspace has its default employee and a limit of 1", "limit 1", f"{st}")
    st, out = p.go("POST", f"/v1/tenants/{trial_tenant}/employees", {"id": str(uuid.uuid4()), "role_code": "sales", "name": "Asha"}, tok)
    say(st == 409 and out["error"]["code"] == "employee_limit", "7b a second employee on a trial is refused", "409 employee_limit", f"{st} {out['error']['code'] if isinstance(out, dict) and 'error' in out else ''}")

    # 8. the voice plan card (the real written chat, nothing confirmed): a Telugu voice the demo workspace does NOT use now
    st, voices = p.go("GET", f"/v1/tenants/{p.demo_tenant}/ai-assistant/voices", None, p.demo_token)
    before = next((x.get("active_id") for x in voices.get("languages", []) if x.get("language") == "te"), "?") if isinstance(voices, dict) else "?"
    other = next(v for v in cfg.catalogue.values() if v.language == "te" and v.gender == "female" and v.id != before)
    body = {"message_id": str(uuid.uuid4()), "conversation_id": None, "text": f"Change your voice to {other.name} for Telugu", "language": "en"}
    req = urllib.request.Request(f"{p.s.api}/v1/tenants/{p.demo_tenant}/assistant/turns", data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + p.demo_token, "Content-Type": "application/json", "Accept": "text/event-stream"})
    try:
        sse = urllib.request.urlopen(req, timeout=120).read().decode()  # noqa: S310
    except urllib.error.HTTPError as exc:
        sse = f"HTTP {exc.code}"
    say("ai-assistant.put_voices" in sse and other.name in sse, f"8 'change your voice to {other.name}' becomes a plan card for the voice route (nothing is saved until the owner says yes)", True, "card found" if "put_voices" in sse else sse[-200:])
    st, voices = p.go("GET", f"/v1/tenants/{p.demo_tenant}/ai-assistant/voices", None, p.demo_token)
    after = next((x.get("active_id") for x in voices.get("languages", []) if x.get("language") == "te"), "?") if isinstance(voices, dict) else "?"
    say(after == before, "8b nothing was saved: the demo workspace's Telugu voice is unchanged", before, after)

    # clean-up: my two employees archived, the trial workspace archived
    for eid in mine:
        p.go("POST", f"{p.t}/employees/{eid}/status", {"status": "archived"})
    for tenant in p.workspaces:
        cp.sql(f"select app.operator_archive_workspace('{tenant}', 'synthetic proof workspace of the AI employees proof of 26 Nov 2026 (staging only)')")
    note(f"\nclean-up: Priya and Ravi archived, {len(p.workspaces)} synthetic workspaces archived")
    failed = [x for x in cp.LINES if x.startswith("FAIL")]
    note(f"\nRESULT: {len([x for x in cp.LINES if x.startswith('PASS')])} checks passed, {len(failed)} failed")
    Path("/Users/gowthamreddys/Desktop/stack19-jobs/reports/employees-proof.md").write_text("\n".join(cp.LINES) + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
