"""The demo data of the three businesses that example data cannot give (job DG), written ONCE and used by the hosted seed (scripts/seed_staging.py) and the local seed (scripts/seed_demo_school.py).

Both go through OUR API as the demo owner (row-level security applies, nothing is written around it) and are idempotent: every row has a fixed id and a second run changes nothing. They create a row only when it is
absent and never overwrite one that is there, so a re-seed or a deploy can never undo what a person did (the construction product the owner hid stays hidden; DG found a smoke test flipping it back on every run).

  * construction_materials: ONE visible demo product with its own figures (price, GST, pieces per area, ...), a generated placeholder picture (an active product needs one) and the materials rules, so the quote screen has something to quote on a fresh workspace;
  * education: a school with its institution profile, a class, three students with a guardian each (FAKE phone numbers) and a fee plan with two instalments already due and one to come, one part payment, so the fee
    ledger has an audience and the figures differ.

THE PHONE NUMBERS are in the app's existing fake-number convention: country code `+00`, which is not a dialling code, so a number written `+00 000 000 71NN` can never ring or message anyone, anywhere (the
real-data gate itself only accepts such numbers while it is closed). The children's labels are `Demo A`, `Demo B`, `Demo C`; the guardians are `Demo Parent A (synthetic)` and so on. Nothing here is a real person."""

from __future__ import annotations

import base64
import json
import struct
import time
import uuid
import zlib
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
NS = uuid.UUID("3f6c1c2e-8a41-4d0a-9b57-6e1d2c4f9a10")
Call = Callable[..., tuple[int, Any]]  # call(method, path_after_the_tenant, body=None, raw=(bytes, content_type)) -> (status, json)
I = "/institution"  # the school routes live under the tenant's /institution
PHONES = ["+00 000 000 7101", "+00 000 000 7102", "+00 000 000 7103"]


class DemoError(Exception):
    """A readable failure; no message holds a key, a token or a response body."""


def did(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def placeholder_png(width: int = 640, height: int = 480, rgb: tuple[int, int, int] = (176, 98, 62)) -> bytes:
    """A plain coloured picture, made here with the standard library (no imaging package in the seed): an invented placeholder, clearly not a photo of anything."""
    row = b"\x00" + bytes(rgb) * width

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(row * height, 9)) + chunk(b"IEND", b"")


def _ok(label: str, result: tuple[int, Any], want: tuple[int, ...] = (200, 201)) -> Any:
    status, body = result
    if status not in want:
        code = body.get("error", {}).get("code") if isinstance(body, dict) and isinstance(body.get("error"), dict) else None
        raise DemoError(f"{label}: HTTP {status}" + (f" ({code})" if code else ""))
    return body


# ----------------------------------------------------------------------------- construction materials
def construction_materials(call: Call) -> dict[str, str]:
    """The materials rules (the worked example's, without laying) and ONE visible demo product. Created only when absent."""
    vectors = json.loads((ROOT / "packages/quote-engine/tests/fixtures/construction_vectors.json").read_text(encoding="utf-8"))["vectors"]
    policy = next(v for v in vectors if v["name"].startswith("worked_example"))["request"]["policy"]
    policy = {k: v for k, v in policy.items() if k != "laying"}
    item = did("construction-demo-product")
    if call("GET", "/materials/policy")[1].get("current") is None:
        _ok("materials policy", call("POST", "/materials/policy", {"version_id": did("construction-demo-policy"), "policy": policy}))
    status, current = call("GET", f"/materials/items/{item}")  # an item that does not exist answers 422 invalid_reference, not 404
    body = {"name": "Demo: Paver block 200 x 100 mm, 80 mm (synthetic)", "sell_unit": "sq_ft", "area_unit": "sq_ft", "stock_status": "in_stock", "price_paise": 6500}
    if status == 200 and isinstance(current, dict) and (current.get("active") or current.get("photos")):
        return {"demo product": "already there (left as it is)"}  # shown, or hidden by a person after it had a picture: not ours to change
    if status != 200:
        # a product can be shown to customers only once its figures are complete: made hidden, figures set, then (below) a picture, then shown
        _ok("demo product", call("PUT", f"/materials/items/{item}", {**body, "active": False}))
        _ok("demo product figures", call("PUT", f"/catalogue/{item}/custom", {"values": {"product_type": "paver_block", "thickness_mm": "80", "size": "200 x 100 mm", "pieces_per_area": 4.5, "pieces_per_pallet": 500, "minimum_order": 100, "lead_days": 3, "hsn_code": "68101990", "gst_rate_percent": 18}}))
    # an active product needs a photo (the database refuses otherwise: SM521); a generated placeholder, uploaded through the API like a real one
    _ok("demo product picture", call("POST", f"/materials/items/{item}/photos?photo_id={did('construction-demo-photo')}", raw=(placeholder_png(), "image/png")))
    _ok("demo product shown", call("PUT", f"/materials/items/{item}", {**body, "active": True}))
    return {"demo product": "created (a placeholder picture, shown to customers)"}


# ----------------------------------------------------------------------------- education
def academic_year(today: date) -> str:
    start = today.year if today.month >= 4 else today.year - 1
    return f"{start}-{(start + 1) % 100:02d}"


def education(call: Call, today: date) -> dict[str, str]:
    """A school with a class, three students (fake guardian phones) and a fee plan with dues. Each piece only when absent."""
    out: dict[str, str] = {}
    if not call("GET", f"{I}/profile")[1].get("configured"):
        _ok("institution", call("PUT", f"{I}/profile", {"institution_type": "school", "year_start_month": 4, "terms": [], "parent_languages": ["en", "te"]}))
        out["institution"] = "set (a school, the year starts in April)"
    programme = did("school-class-5")
    _ok("class", call("PUT", f"{I}/programmes/{programme}", {"name": "Demo: Class 5", "kind": "class", "group_kind": "none", "active": True}))
    students: list[str] = []
    for i, label in enumerate(("Demo A", "Demo B", "Demo C")):
        contact, student = did(f"school-guardian-{i}"), did(f"school-student-{i}")
        _ok("guardian", call("POST", "/contacts", {"id": contact, "full_name": f"Demo Parent {'ABC'[i]} (synthetic)", "phone": PHONES[i]}), (200, 201, 409))
        _ok("student", call("PUT", f"{I}/students/{student}", {"contact_id": contact, "is_adult": False, "child_label": label, "programme_id": programme, "admission_no": f"DEMO-{i + 1:03d}", "joined_on": (today - timedelta(days=200)).isoformat()}))
        students.append(student)
    plan = did("school-fee-plan")
    if call("GET", f"{I}/fee-plans/{plan}")[0] != 200:
        lines = [(1, today - timedelta(days=60), 600_000), (2, today - timedelta(days=20), 600_000), (3, today + timedelta(days=45), 600_000)]
        _ok("fee plan", call("PUT", f"{I}/fee-plans/{plan}", {"name": "Demo: Class 5 fees (synthetic)", "programme_id": programme, "academic_year": academic_year(today), "lines": [{"head": "tuition", "instalment_no": n, "due_date": d.isoformat(), "amount_paise": a} for n, d, a in lines]}))
        out["fee plan"] = "created: two instalments of Rs 6,000 already due, one to come"
    for i, student in enumerate(students):
        _ok("fee assignment", call("PUT", f"{I}/fee-assignments/{did(f'school-assignment-{i}')}", {"student_id": student, "plan_id": plan}))
    # one part payment, so the three families do not owe the same
    _ok("payment", call("PUT", f"{I}/students/{students[0]}/payments/{did('school-payment-0')}", {"received_on": today.isoformat(), "amount_paise": 400_000, "method": "upi"}))
    out["students"] = "three, with a guardian each (fake +00 numbers); one part payment of Rs 4,000"
    return out


# ----------------------------------------------------------------------------- Lead Desk demo workspaces (night 4, job DR part B2)
IST = timezone(timedelta(hours=5, minutes=30))
CONSENT = {"confirmed": True, "list_name": "Demo leads (synthetic)", "purpose": "Showing the product with invented people", "basis": "explicit_consent", "how_collected": "Invented for the demo; no real person"}
OUTCOME_SCRIPT = [
    ("no_answer", None),
    ("connected", {"outcome": "positive", "category": "interested", "captured": "interested"}),
    ("connected", {"outcome": "negative", "category": "not_interested", "reason": "Not looking this year"}),
    ("connected", {"outcome": "unclear", "category": "call_back_later", "callback": True}),
    ("voicemail", None),
    ("connected", {"outcome": "negative", "category": "already_bought", "reason": "Already booked with someone else"}),
    ("connected", {"outcome": "negative", "category": "wrong_number", "stop": True}),
    ("connected", {"outcome": "positive", "category": "visit_booked", "captured": "visit"}),
]


def _csv(rows: list[list[str]], header: list[str]) -> str:
    def cell(v: str) -> str:
        return '"' + v.replace('"', '""') + '"' if any(c in v for c in ',"\n') else v

    return "\n".join(",".join(cell(c) for c in r) for r in [header, *rows]) + "\n"


def _arrived(today: date, i: int) -> str:
    """When lead number i arrived: spread over the last six days, working hours, India time."""
    day = today - timedelta(days=i % 6)
    return datetime(day.year, day.month, day.day, 10 + (i * 7) % 9, (i * 13) % 60, tzinfo=IST).isoformat()


def _people(spec: dict[str, Any], source: str, today: date) -> list[list[str]]:
    rows = []
    for i, (name, city, message) in enumerate(spec["leads"][source]):
        rows.append([f"{name} (demo)", f"+00 000 000 {spec['phone_base'] + spec['source_order'].index(source) * 20 + i}", city, message, _arrived(today, i)])
    return rows


def lead_desk(call: Call, spec: dict[str, Any], today: date, *, tasks: bool = True) -> dict[str, str]:
    """A workspace of the "Leads & calls" family with a working Lead Desk: approved facts, leads from four sources (with costs), a standing rule, one batch approved once with outcomes and hand-offs, and two tasks
    (a finished supplier price enquiry and a second one left to run). Every step is idempotent: a fixed id each, and a piece is created only when absent."""
    out: dict[str, str] = {}
    key = spec["key"]
    # 1. the facts the assistant may state (written by hand, approved by the Owner; a price fact needs the second factor, which the demo owner's token has)
    have = {f["id"] for f in call("GET", "/knowledge/facts?status=approved&limit=100")[1].get("facts", [])}
    for n, (kind, text) in enumerate(spec["facts"]):
        fact = did(f"{key}-fact-{n}")
        if fact in have:
            continue
        _ok("fact", call("POST", "/knowledge/facts", {"fact_id": fact, "kind": kind, "text": text}), (200, 201, 409))
        _ok("fact decision", call("POST", f"/knowledge/facts/{fact}/decide", {"decision": "approve"}), (200, 409))
    out["facts"] = f"{len(spec['facts'])} approved"
    # 2. leads from four sources, as files (a CSV each), with what they cost per lead
    costs = []
    for source in spec["source_order"]:
        rows = _people(spec, source, today)
        csv_text = _csv(rows, ["Name", "Phone", "City", "Message", "Received"])
        body = {"import_id": did(f"{key}-import-{source}"), "kind": "file", "filename": f"{source}.csv", "content_base64": base64.b64encode(csv_text.encode()).decode(), "use_ai": False,
                "mapping": {"name": 0, "phone": 1, "city": 2, "message": 3, "received_at": 4}, "source": source, "consent": CONSENT, "cost_per_lead_paise": spec["costs"][source]}
        _ok(f"import {source}", call("POST", "/lead-imports", body), (200, 201))
        costs.append({"source": source, "cost_per_lead_paise": spec["costs"][source]})
    _ok("source costs", call("PUT", "/outreach/source-costs", {"costs": costs}))
    out["leads"] = ", ".join(f"{len(spec['leads'][s])} from {s}" for s in spec["source_order"])
    # 3. a standing rule: new leads from Meta get a call within two minutes (not retroactive: the leads above came before it)
    _ok("rule", call("POST", "/outreach/rules", {"rule_id": did(f"{key}-rule"), "source": "meta_lead_ads", "action": "call_within_minutes", "within_minutes": 2, "goal": spec["goal"], "channel": "call",
                                                  "language": spec["language"], "questions": spec["questions"], "max_calls_per_day": 100}), (200, 201, 409))
    out["rule"] = "meta_lead_ads: call within 2 minutes"
    # 4. one batch approved ONCE (the Excel leads), with some outcomes reported so the reports and the hand-offs have something to show
    batch = did(f"{key}-batch")
    st, got = call("GET", f"/outreach/batches/{batch}")
    if st != 200:
        _ok("batch plan", call("POST", "/outreach/batches", {"batch_id": batch, "name": spec["batch_name"], "goal": spec["goal"], "channel": "call", "language": spec["language"],
                                                              "who": {"source": {"source": "excel_upload", "status": "new"}}, "questions": spec["questions"]}), (200, 201))
        st, got = call("GET", f"/outreach/batches/{batch}")
    if st == 200 and got["batch"]["status"] == "planned":
        _ok("batch approval", call("POST", f"/outreach/batches/{batch}/approve", {"plan_sha256": got["batch"]["plan_sha256"]}))
    items = call("GET", f"/outreach/batches/{batch}/items")[1].get("items", [])
    reported = 0
    for item, (result, outcome) in zip(items, OUTCOME_SCRIPT, strict=False):
        if item["status"] != "waiting" or item["attempts"]:
            continue
        payload: dict[str, Any] = {"result": result, "minutes": 0.3 if outcome is None else 2.5}
        if outcome:
            o = {k: v for k, v in outcome.items() if k not in ("captured", "callback", "stop")}
            if outcome.get("captured") == "interested":
                o["captured"] = dict(spec["captured_interested"])
            if outcome.get("captured") == "visit":
                o["captured"] = dict(spec["captured_visit"])
            if outcome.get("callback"):
                o["callback_at"] = (datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=IST) + timedelta(hours=11)).isoformat()
            payload["outcome"] = o
            payload["stop"] = bool(outcome.get("stop"))
        # the worker's fake dialer may have taken this item first: a refusal for that reason is not an error
        status, _ = call("POST", f"/outreach/items/{item['id']}/result", payload)
        if status == 200:
            reported += 1
        elif status != 409:
            raise DemoError(f"outcome of an item: HTTP {status}")
    out["batch"] = f"{spec['batch_name']}: approved once; {reported} outcomes reported now"
    # 5. tasks ("Ask Vijaya to do it"): the suppliers of the business are contacts first, then one finished enquiry and one left running
    if tasks:
        out.update(_tasks(call, spec, today))
    return out


def _tasks(call: Call, spec: dict[str, Any], today: date) -> dict[str, str]:
    key = spec["key"]
    suppliers = [[f"{name} (demo)", f"+00 000 000 {spec['phone_base'] + 90 + n}", "", "", _arrived(today, n)] for n, name in enumerate(spec["suppliers"])]
    body = {"import_id": did(f"{key}-import-suppliers"), "kind": "file", "filename": "suppliers.csv", "use_ai": False,
            "content_base64": base64.b64encode(_csv(suppliers, ["Name", "Phone", "City", "Message", "Received"]).encode()).decode(),
            "mapping": {"name": 0, "phone": 1, "city": 2, "message": 3, "received_at": 4}, "source": "pasted_list",
            "consent": {**CONSENT, "list_name": "Demo suppliers (synthetic)", "basis": "contractual"}}
    _ok("suppliers", call("POST", "/lead-imports", body), (200, 201))
    out: dict[str, str] = {}
    for label, instruction, with_list in spec["tasks"]:
        task = did(f"{key}-task-{label}")
        st, current = call("GET", f"/tasks/{task}")
        if st != 200:
            plan_body: dict[str, Any] = {"task_id": task, "instruction": instruction, "language": "en"}
            if with_list:
                plan_body["contacts"] = [{"name": r[0], "phone": r[1]} for r in suppliers]
            st, current = call("POST", "/tasks/plan", plan_body)
            if st not in (200, 201):
                out[f"task {label}"] = f"not planned (HTTP {st}); run the seed again"
                continue
        if current["status"] == "planned":
            st, current = call("POST", f"/tasks/{task}/approve", {"plan_sha256": current["plan_sha256"]})
            if st != 200:
                out[f"task {label}"] = f"planned, not approved (HTTP {st})"
                continue
        for _ in range(12):   # the run goes on in the background; look a few times
            if current["status"] in ("done", "paused", "cancelled"):
                break
            time.sleep(2)
            st, current = call("GET", f"/tasks/{task}")
        out[f"task {label}"] = str(current["status"])
    return out


REAL_ESTATE = {
    "key": "realestate", "phone_base": 8100, "language": "te", "goal": "site_visit", "batch_name": "Gachibowli launch: Excel enquiries",
    "source_order": ["meta_lead_ads", "indiamart", "website_form", "excel_upload"],
    "costs": {"meta_lead_ads": 18000, "indiamart": 30000, "website_form": 0, "excel_upload": 0},
    "questions": ["What budget are you comfortable with?", "Which area do you prefer?", "When can you visit the site?"],
    "captured_interested": {"budget": "1.2 crore", "area": "Gachibowli"}, "captured_visit": {"budget": "80 lakh", "area": "Kondapur", "visit": "Saturday 11 am"},
    "facts": [
        ("product_service", "Sri Sai Homes builds 2 and 3 BHK apartments in Gachibowli and Kondapur, Hyderabad."),
        ("location", "The Gachibowli site is 10 minutes from the Financial District; the sales office is at the site."),
        ("hours", "The sales office is open Monday to Saturday, 9:30 am to 6:30 pm. Site visits on Sunday by appointment."),
        ("policy", "RERA registration details are shown at the sales office and on every brochure."),
        ("faq", "Home loans from major banks are available; our team helps with the paperwork."),
    ],
    "leads": {
        "meta_lead_ads": [("Anitha R", "Hyderabad", "Looking for a 3BHK near Gachibowli, budget around 1.2 crore"), ("Kiran P", "Hyderabad", "Please send details of 2BHK flats"), ("Swathi M", "Secunderabad", "Interested in a site visit this weekend"),
                          ("Ravi T", "Hyderabad", "Is the Kondapur project ready to move in?"), ("Divya S", "Hyderabad", "Need a flat for my parents, ground floor"), ("Mahesh G", "Warangal", "Investment property, 2BHK"),
                          ("Lavanya K", "Hyderabad", "What is the possession date?"), ("Sandeep V", "Hyderabad", "Send brochure on WhatsApp")],
        "indiamart": [("Venu B", "Hyderabad", "Enquiry: 3BHK flat Gachibowli"), ("Harini D", "Hyderabad", "Enquiry: apartments with clubhouse"), ("Naveen Y", "Hyderabad", "Enquiry: ready to move 2BHK"),
                      ("Pooja A", "Hyderabad", "Enquiry: flats under 90 lakh"), ("Srinivas C", "Hyderabad", "Enquiry: 3BHK east facing")],
        "website_form": [("Meena L", "Hyderabad", "I want to visit on Sunday"), ("Prakash N", "Hyderabad", "Call me after 6 pm"), ("Geetha R", "Hyderabad", "Do you have 3BHK corner flats?"), ("Arun J", "Hyderabad", "Loan help needed")],
        "excel_upload": [("Bhaskar S", "Hyderabad", "From the property fair list"), ("Uma D", "Hyderabad", "From the property fair list"), ("Chaitanya M", "Hyderabad", "From the property fair list"), ("Padma V", "Hyderabad", "From the property fair list"),
                         ("Yadav K", "Hyderabad", "From the property fair list"), ("Rekha P", "Hyderabad", "From the property fair list"), ("Satish B", "Hyderabad", "From the property fair list"), ("Jyothi N", "Hyderabad", "From the property fair list"),
                         ("Murali G", "Hyderabad", "From the property fair list"), ("Kavitha A", "Hyderabad", "From the property fair list")],
    },
    "suppliers": ["Sai Cement Traders", "Venkateswara Steel", "Balaji Tiles and Sanitary", "Hanuman Sand and Aggregates"],
    "tasks": [
        ("supplier-enquiry", "Ask my four suppliers for today's price per bag of cement and steel per tonne, and which day they can deliver.", True),
        ("call-new-leads", "Call the new leads from this week who have not been called yet and ask if they want to visit the Gachibowli site on Saturday.", False),
    ],
}

COACHING = {
    "key": "coaching", "phone_base": 8200, "language": "te", "goal": "counselling", "batch_name": "Summer batch: Excel enquiries",
    "source_order": ["meta_lead_ads", "indiamart", "website_form", "excel_upload"],
    "costs": {"meta_lead_ads": 9000, "indiamart": 15000, "website_form": 0, "excel_upload": 0},
    "questions": ["Which class or exam is the student preparing for?", "Which subjects need the most help?", "When can you come for a counselling session?"],
    "captured_interested": {"class": "Class 10", "subject": "Maths"}, "captured_visit": {"class": "Class 12", "subject": "Physics", "visit": "Saturday 5 pm"},
    "facts": [
        ("product_service", "Vidya Coaching Centre, Vijayawada, offers tuition for Classes 8 to 12 and entrance exam batches."),
        ("hours", "Classes run Monday to Saturday, 4 pm to 8 pm. The office is open 10 am to 7 pm."),
        ("location", "The centre is near Benz Circle, Vijayawada, on the first floor above the bookshop."),
        ("policy", "A free demo class is available before joining; there is no obligation."),
        ("faq", "Batches have at most 25 students; study material is included."),
    ],
    "leads": {
        "meta_lead_ads": [("Sunitha K", "Vijayawada", "Maths tuition for my son in Class 10"), ("Rajesh V", "Vijayawada", "Fees for Class 12 physics batch?"), ("Bhavani P", "Guntur", "Do you have weekend batches?"),
                          ("Srikanth D", "Vijayawada", "Demo class for Class 9 science"), ("Madhavi R", "Vijayawada", "EAMCET coaching details please"), ("Ramesh S", "Machilipatnam", "Hostel facility available?"),
                          ("Sridevi T", "Vijayawada", "Timings for Class 8 maths"), ("Anil B", "Vijayawada", "Send the batch list on WhatsApp")],
        "indiamart": [("Lakshmi N", "Vijayawada", "Enquiry: tuition Class 10"), ("Prasad K", "Vijayawada", "Enquiry: IIT foundation course"), ("Hima Bindu M", "Vijayawada", "Enquiry: NEET coaching"),
                      ("Narasimha R", "Eluru", "Enquiry: Class 12 batch"), ("Vani G", "Vijayawada", "Enquiry: spoken English")],
        "website_form": [("Teja S", "Vijayawada", "Counselling session on Saturday please"), ("Padmaja A", "Vijayawada", "Call me in the evening"), ("Kishore Y", "Vijayawada", "Fee structure for Class 11"), ("Rani C", "Vijayawada", "Is there a scholarship test?")],
        "excel_upload": [("Mohan B", "Vijayawada", "From the school visit list"), ("Sirisha D", "Vijayawada", "From the school visit list"), ("Gopal M", "Vijayawada", "From the school visit list"), ("Aruna V", "Vijayawada", "From the school visit list"),
                         ("Harsha K", "Vijayawada", "From the school visit list"), ("Deepa P", "Vijayawada", "From the school visit list"), ("Vikram S", "Vijayawada", "From the school visit list"), ("Anusha N", "Vijayawada", "From the school visit list"),
                         ("Bala R", "Vijayawada", "From the school visit list"), ("Swarna G", "Vijayawada", "From the school visit list")],
    },
    "suppliers": ["Sri Lakshmi Books and Stationery", "Rama Xerox and Printing", "Krishna Furniture Works", "Sai Projector Services"],
    "tasks": [
        ("supplier-enquiry", "Ask my four suppliers for the price of 100 study material sets and the day they can deliver.", True),
        ("call-new-leads", "Call the parents who enquired this week and ask if they want a free demo class on Saturday.", False),
    ],
}


def real_estate(call: Call, today: date, *, tasks: bool = True) -> dict[str, str]:
    """Sri Sai Homes (synthetic): a builder in Hyderabad."""
    return lead_desk(call, REAL_ESTATE, today, tasks=tasks)


def coaching(call: Call, today: date, *, tasks: bool = True) -> dict[str, str]:
    """Vidya Coaching Centre (synthetic): tuition and entrance coaching in Vijayawada."""
    return lead_desk(call, COACHING, today, tasks=tasks)
