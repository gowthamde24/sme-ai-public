# ruff: noqa: E501  (long lines are this repository's seed-script style; its pyproject lists the other seed scripts under per-file E501 ignores)
"""A believable week of SYNTHETIC data for the owner's three test workspaces on staging (job test-workspaces, 4 Nov 2026), used by scripts/seed_owner_test.py (`--phase seed`).

    seed(pack, call) -> dict[str, str]      call(method, path_after_the_tenant, body=None, raw=None) -> (status, json), exactly as scripts/demo_data.py

Everything goes through OUR API as the helper account of the workspace (row-level security applies; no SQL, no deletes). Every row has a fixed id (`did`), a piece is created only when it is absent and nothing a person
may have changed is written again, so a second run changes nothing. Nothing is SENT: no outbox message, no campaign approval, no trip notice, no visit message; quotes are approved only where the quote flow sends
nothing by itself (it renders a text and records the decision), and some quotes are left WAITING on purpose. Every figure of a quote or an order is the app's own (the pinned engines); the script only sets the
catalogue and price-list prices and the school's fee plan, and reads the rest back (an advance paid is the order's own advance).

THE PEOPLE ARE INVENTED. Phones are in the app's fake convention `+00 000 000 NNNN` (64NN textiles, 65NN construction, 66NN education: ranges no other seed uses), e-mails are on the reserved `example.test`
domain; nobody real can be reached. The workspaces' real-data gate stays closed (scripts/seed_owner_test.py checks it).

  textiles                 Lakshmi Silks (test), Dharmavaram: 20 customers (WhatsApp, e-mail, IndiaMART, walk-in, website), 12 sarees with stock, 6 wholesale products on a price list, a quote policy,
                           5 quotes (2 waiting for approval), 3 orders, follow-ups due (2 drafts waiting), 3 store visits.
  construction_materials   Sri Sai Cements (test), Anantapur: 20 customers, 9 products (cement, TMT steel, paver blocks, kerb stones, bricks, M-sand) with stock, 6 material quotes (2 waiting),
                           4 orders (one cancelled after its advance: money held), 2 trips today, a balance invoice due this week, follow-ups due, 2 call-backs waiting for the Owner.
  education                Vidya Public School (test), Anantapur: 4 classes with sections, fee plans, 16 students with guardians, payments (some today, some overdue), 9 admission enquiries across sources and
                           stages, 2 campus visits today, 2 call-backs waiting for the Owner, a fee reminder left as a DRAFT (nothing goes until the Owner approves it). No outreach, no lead finding.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any

import demo_data
from demo_data import ROOT, Call, DemoError, academic_year, placeholder_png

IST = timezone(timedelta(hours=5, minutes=30))
INST = "/institution"


def did(name: str) -> str:
    """A fixed id of this job (its own prefix inside demo_data's namespace, so no id can meet one of the demo seeds)."""
    return demo_data.did(f"owner-test/{name}")


def _code(body: Any) -> str | None:
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        code = body["error"].get("code")
        return str(code) if code else None
    return None


def _fresh(status: int, body: Any) -> bool:
    """Was a row made now (201, `created: true` or `replayed: false`), or was it already there?"""
    if status == 201:
        return True
    if isinstance(body, dict):
        if body.get("created") is True or body.get("replayed") is False:
            return True
    return False


class Seeder:
    def __init__(self, call: Call, pack: str, today: date) -> None:
        self.call, self.pack, self.today = call, pack, today
        self.made: Counter[str] = Counter()
        self.kept: Counter[str] = Counter()
        self.problems: list[str] = []
        self.notes: dict[str, str] = {}

    # ------------------------------------------------------------------ plumbing
    def req(self, label: str, method: str, path: str, body: Any = None, raw: tuple[bytes, str] | None = None, ok: tuple[int, ...] = (200, 201), kind: str | None = None) -> Any:
        status, out = self.call(method, path, body, raw) if raw is not None else self.call(method, path, body)
        if status not in ok:
            code = _code(out)
            raise DemoError(f"{label}: {method} {path.split('?')[0]} HTTP {status}" + (f" ({code})" if code else ""))
        if kind is not None:
            (self.made if _fresh(status, out) else self.kept)[kind] += 1
        return out

    def get(self, path: str) -> tuple[int, Any]:
        result: tuple[int, Any] = self.call("GET", path)
        return result

    def piece(self, name: str, fn: Callable[[], Any]) -> Any:
        """One piece of the seed; a failure is written down and the rest goes on (the stop rule: a call that fails is not hammered)."""
        try:
            return fn()
        except DemoError as e:
            self.problems.append(f"{name}: {e}")
            return None

    def summary(self) -> dict[str, str]:
        out = dict(self.notes)
        kinds = sorted(set(self.made) | set(self.kept))
        out["rows"] = "; ".join(f"{k}: {self.made[k]} new, {self.kept[k]} already there" for k in kinds)
        out["problems"] = " | ".join(self.problems) if self.problems else "none"
        return out

    def at(self, days_ago: int, hour: int, minute: int = 0) -> str:
        day = self.today - timedelta(days=days_ago)
        return datetime(day.year, day.month, day.day, hour, minute, tzinfo=IST).isoformat()

    # ------------------------------------------------------------------ people
    def customers(self, prefix: str, people: list[tuple[str, str, str | None, str, str, str, str | None]], phone_base: int) -> dict[str, dict[str, str]]:
        """(key, person, shop or None, city, region, source, e-mail local part or None) -> a company (the shop, or the person for a private buyer), a contact with a fake phone, and a lead with its source."""
        ids: dict[str, dict[str, str]] = {}
        for n, (key, person, shop, city, region, source, mail) in enumerate(people, start=1):
            company, contact, lead = did(f"{prefix}-{key}-company"), did(f"{prefix}-{key}-contact"), did(f"{prefix}-{key}-lead")
            ids[key] = {"company": company, "contact": contact, "lead": lead, "person": person}

            def one(company: str = company, contact: str = contact, lead: str = lead, person: str = person, shop: str | None = shop, city: str = city, region: str = region,
                    source: str = source, mail: str | None = mail, n: int = n) -> None:
                self.row("companies", {"id": company, "name": shop or person, "type": "prospect", "country": "IN", "region": region, "city": city}, "companies")
                body: dict[str, Any] = {"id": contact, "company_id": company, "full_name": person, "phone": f"+00 000 000 {phone_base + n}"}
                if mail:
                    body["email"] = f"{mail}@example.test"
                self.row("contacts", body, "contacts")
                self.row("leads", {"id": lead, "company_id": company, "contact_id": contact, "source": source}, f"leads ({source})")

            self.piece(f"customer {key}", one)
        return ids

    def row(self, entity: str, body: dict[str, Any], kind: str) -> None:
        """A CRM row by its fixed id, made only when absent: a row that is there is never sent again (a person may have edited it, and the API answers a changed replay with a conflict)."""
        if self.get(f"/{entity}/{body['id']}")[0] == 200:
            self.kept[kind] += 1
            return
        self.req(entity, "POST", f"/{entity}", body, kind=kind)

    def consent(self, contact: str, channel: str, evidence: tuple[str, str]) -> None:
        """Write down the consent the customer gave, once (a second run finds it granted and records nothing)."""
        st, row = self.get(f"/contacts/{contact}")
        if st == 200 and isinstance(row, dict) and row.get(f"{channel}_consent") == "granted":
            self.kept["consents"] += 1
            return
        self.req("consent", "POST", f"/contacts/{contact}/record-consent",
                 {"channel": channel, "status": "granted", "basis": "explicit_consent", "evidence_type": evidence[0], "evidence_ref": evidence[1]})
        self.made["consents"] += 1

    def followup_policy(self, key: str) -> None:
        """The follow-up rules (the Owner can change them in Settings): the first follow-up the same day if there is no reply (the leads are new today, so an earlier first message cannot be dated: the
        API refuses a touch older than its lead), then two days later; three messages at most; Monday to Saturday; nothing between 22:00 and 06:00 India time."""
        version = did(f"{key}-followup-policy")
        st, listed = self.get("/followup-policy-versions")
        if st == 200 and isinstance(listed, list) and listed:
            self.kept["follow-up policy"] += 1
            return  # the workspace has rules already (ours or a person's): never replaced
        self.req("follow-up policy", "POST", "/followup-policy-versions", {
            "id": version, "effective_from": self.today.isoformat(), "gap_days": [0, 2], "max_touches": 3, "quiet_start": "22:00", "quiet_end": "06:00",
            "allowed_weekdays": [0, 1, 2, 3, 4, 5], "holidays": [], "min_gap_hours": 0, "recipient_utc_offset_minutes": 330}, kind="follow-up policy")

    def first_message(self, key: str, lead: str, channel: str) -> None:
        """'I sent the first message myself' (a record of something a person did; nothing is sent). An exact retry replays."""
        self.req("first message", "POST", f"/leads/{lead}/touches", {"id": did(f"{key}-touch-1"), "direction": "out", "channel": channel}, kind="first messages recorded")

    def followup_draft(self, key: str, lead: str, channel: str) -> None:
        """A follow-up DRAFT waiting for the Owner's approval (the wording is the app's fixed template; nothing is sent)."""
        self.req("follow-up draft", "POST", f"/leads/{lead}/followup-drafts", {"id": did(f"{key}-draft-2"), "channel": channel}, ok=(200, 201, 409), kind="follow-up drafts")

    def call_request(self, key: str, lead: str, reason: str, script: str, language: str = "en") -> None:
        """A request to phone a customer, waiting for the Owner (approving it records the decision and dials nobody)."""
        rid = did(f"{key}-call")
        if self.get(f"/call-requests/{rid}")[0] == 200:
            self.kept["call-backs waiting"] += 1
            return
        self.req("call request", "POST", "/call-requests", {"request_id": rid, "lead_id": lead, "reason": reason, "script_draft": script, "language": language}, kind="call-backs waiting")

    def enquiry(self, key: str, lead: str, channel: str, received_at: str, subject: str, text: str) -> str:
        eid = did(f"{key}-enquiry")
        self.req("enquiry", "POST", f"/leads/{lead}/enquiries", {"id": eid, "channel": channel, "received_at": received_at, "subject": subject, "text": text}, kind="enquiries")
        return eid

    def requirement(self, eid: str, fields: list[tuple[int | None, str, str]]) -> str | None:
        """Type the requirement a person read from the enquiry and confirm it (a confirmed one is never typed again). Returns its id."""
        st, view = self.get(f"/enquiries/{eid}/requirement")
        current = view.get("requirement") if st == 200 and isinstance(view, dict) else None
        if current is not None and current.get("status") == "confirmed":
            return str(current["id"])
        rid: str | None = None
        for line, field, value in fields:
            body: dict[str, Any] = {"field": field, "value": value}
            if line is not None:
                body["line"] = line
            rid = str(self.req(f"requirement field {field}", "POST", f"/enquiries/{eid}/requirement-fields", body)["requirement_id"])
        if rid is not None:
            self.req("confirm requirement", "POST", f"/requirements/{rid}/confirm")
        return rid

    def order_policy(self, key: str) -> None:
        """The order rules: an advance is asked for, a dispatch waits for it, a customer may cancel until preparation. A new version cannot start in the past, so on a later day the same post is refused:
        that is not an error (the version made on the first day stands)."""
        st, out = self.call("POST", "/order-policy-versions", {"id": did(f"{key}-order-policy"), "effective_from": self.today.isoformat(), "advance_required": True,
                                                               "dispatch_requires_advance": True, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": False})
        (self.made if _fresh(st, out) else self.kept)["order policy"] += 1
        if st not in (200, 201):
            self.notes["order policy"] = f"not posted again (HTTP {st}{', ' + str(_code(out)) if _code(out) else ''}): the first day's version stands"

    def order_steps(self, key: str, order_id: str, steps: list[str]) -> dict[str, Any]:
        """Record what happened to an order, step by step (records only: nothing is sent). A step already recorded is skipped; a payment is the order's OWN advance or balance, read back from the order."""
        detail = self.req("order", "GET", f"/orders/{order_id}")
        done = {str(e.get("id")) for e in detail.get("events", [])}
        for n, step in enumerate(steps, start=1):
            eid = did(f"{key}-event-{n}")
            if eid in done:
                continue
            body: dict[str, Any] = {"id": eid}
            if step in ("pay_advance", "pay_balance"):
                amount = int(detail["advance_paise"]) if step == "pay_advance" else int(detail["balance_paise"])
                body.update(type="record_payment", amount_paise=amount, ledger_id=did(f"{key}-ledger-{n}"))
            else:
                body["type"] = step
            self.req(f"order step {step}", "POST", f"/orders/{order_id}/events", body, ok=(200,))
            self.made["order steps"] += 1
            detail = self.req("order", "GET", f"/orders/{order_id}")
        return dict(detail)

    def visit(self, key: str, lead: str, day: date, slot: str, party: int, purpose: str) -> None:
        vid = did(f"{key}-visit")
        if self.get(f"/visits/{vid}")[0] == 200:
            self.kept["visits"] += 1
            return
        self.req("visit", "POST", "/visits", {"visit_id": vid, "lead_id": lead, "date": day.isoformat(), "slot_start": slot, "party_size": party, "purpose": purpose}, kind="visits")


# ======================================================================================================== textiles
T_PEOPLE: list[tuple[str, str, str | None, str, str, str, str | None]] = [
    # WhatsApp
    ("ramesh", "Ramesh Naidu", "Sri Venkateswara Silks", "Hindupur", "Andhra Pradesh", "whatsapp", None),
    ("padmavathi", "Padmavathi Reddy", "Padmavathi Textiles", "Hindupur", "Andhra Pradesh", "whatsapp", "padmavathi.reddy"),
    ("suresh", "Suresh Babu Gupta", "Gupta Saree Centre", "Kadiri", "Andhra Pradesh", "whatsapp", None),
    ("prasanna", "Lakshmi Prasanna", None, "Anantapur", "Andhra Pradesh", "whatsapp", None),
    ("nagaraju", "Nagaraju Chetty", "Chetty Silk House", "Puttaparthi", "Andhra Pradesh", "whatsapp", None),
    ("bhavani", "Bhavani Shankar", "Bhavani Silks", "Madanapalle", "Andhra Pradesh", "whatsapp", None),
    # e-mail
    ("manjunath", "Manjunath Hegde", "Hegde Silks and Sarees", "Bengaluru", "Karnataka", "email_forward", "manjunath.hegde"),
    ("kamakshi", "Kavitha Subramanian", "Sri Kamakshi Silks", "Chennai", "Tamil Nadu", "email_forward", "kavitha.subramanian"),
    ("srinivas", "Srinivas Rao", "Rao Textiles", "Kurnool", "Andhra Pradesh", "email_forward", "srinivas.rao"),
    ("anuradha", "Anuradha Iyengar", "Anu Boutique", "Mysuru", "Karnataka", "email_forward", "anuradha.iyengar"),
    # IndiaMART
    ("prakash", "Prakash Jain", "Jain Saree Mahal", "Hyderabad", "Telangana", "indiamart", "prakash.jain"),
    ("ramana", "Venkata Ramana", "Ramana Cloth Stores", "Tirupati", "Andhra Pradesh", "indiamart", None),
    ("rafi", "Mohammed Rafi", "Rafi Textiles", "Kadapa", "Andhra Pradesh", "indiamart", None),
    ("gowda", "Shivakumar Gowda", "Gowda Silk Palace", "Tumakuru", "Karnataka", "indiamart", "shivakumar.gowda"),
    # walk-in
    ("saraswathi", "Saraswathi Devi", None, "Dharmavaram", "Andhra Pradesh", "walk_in", None),
    ("harikrishna", "Hari Krishna", "Hari Krishna Fashions", "Penukonda", "Andhra Pradesh", "walk_in", None),
    ("jyothi", "Jyothi Lakshmi", None, "Anantapur", "Andhra Pradesh", "walk_in", None),
    # website
    ("deepika", "Deepika Reddy", None, "Bengaluru", "Karnataka", "website_form", "deepika.reddy"),
    ("raghavendra", "Raghavendra Setty", "Setty Silks", "Ballari", "Karnataka", "website_form", "raghavendra.setty"),
    ("swathi", "Swathi Kiran", "Swathi Designer Studio", "Hyderabad", "Telangana", "website_form", "swathi.kiran"),
]

# the retail catalogue: name, fabric, colours, zari, border, occasions, price band, exact price (paise), stock, the placeholder colour
SAREES: list[tuple[str, str, list[str], str, str | None, list[str], str, int, str, tuple[int, int, int]]] = [
    ("Dharmavaram pattu, maroon with gold zari border", "dharmavaram_silk", ["maroon", "gold"], "rich", "Gold zari, 6 inch", ["wedding"], "10k_25k", 1_450_000, "in_stock", (110, 20, 40)),
    ("Dharmavaram pattu, bottle green with mustard border", "dharmavaram_silk", ["green", "yellow"], "rich", "Mustard and gold", ["wedding", "festival"], "10k_25k", 1_280_000, "few_left", (20, 80, 50)),
    ("Dharmavaram bridal pattu, red and gold checks", "dharmavaram_silk", ["red", "gold"], "rich", "Temple border, rich pallu", ["wedding"], "25k_50k", 2_850_000, "made_to_order", (170, 20, 30)),
    ("Dharmavaram soft silk, peacock blue", "soft_silk", ["blue"], "light", "Thin silver zari", ["festival", "party"], "5k_10k", 790_000, "in_stock", (20, 90, 140)),
    ("Dharmavaram half-fine zari, rose pink", "dharmavaram_silk", ["pink", "gold"], "light", "Half-fine zari", ["festival"], "5k_10k", 940_000, "in_stock", (210, 110, 140)),
    ("Kanchi pattu, mango yellow with pink border", "kanchi_pattu", ["yellow", "pink"], "rich", "Korvai pink border", ["wedding"], "25k_50k", 3_200_000, "few_left", (220, 170, 30)),
    ("Kanchi pattu, navy with temple border", "kanchi_pattu", ["navy", "gold"], "rich", "Temple border", ["wedding", "festival"], "10k_25k", 1_850_000, "in_stock", (20, 30, 80)),
    ("Mysore crepe silk, purple with zari edge", "mysore_silk", ["purple"], "light", "Zari edge", ["party"], "5k_10k", 860_000, "in_stock", (90, 40, 120)),
    ("Uppada silk, cream with silver zari", "uppada", ["cream", "silver"], "light", "Silver jamdani", ["festival"], "10k_25k", 1_120_000, "in_stock", (235, 225, 200)),
    ("Banarasi katan silk, red with gold buttas", "banarasi", ["red", "gold"], "rich", "Gold buttas", ["wedding"], "10k_25k", 1_690_000, "few_left", (180, 30, 30)),
    ("Cotton silk, orange and green checks", "cotton_silk", ["orange", "green"], "none", None, ["daily"], "under_5k", 245_000, "in_stock", (230, 120, 30)),
    ("Venkatagiri cotton, white with gold border", "pure_cotton", ["white", "gold"], "light", "Gold border", ["daily"], "under_5k", 185_000, "in_stock", (245, 245, 240)),
]

# the wholesale products the quotes price: sku, name (the price list's name too), rupees per piece, minimum order, a price break (pieces, rupees)
PRODUCTS: list[tuple[str, str, int, int, tuple[int, int] | None]] = [
    ("DMV-PT-MRN", "Dharmavaram pattu saree maroon gold zari", 9800, 2, (10, 9400)),
    ("DMV-PT-GRN", "Dharmavaram pattu saree green mustard border", 8600, 2, (10, 8250)),
    ("DMV-BRD-RED", "Dharmavaram bridal pattu red gold checks", 19500, 1, None),
    ("DMV-SFT-BLU", "Dharmavaram soft silk saree peacock blue", 5200, 4, (20, 4950)),
    ("KNC-PT-YLW", "Kanchi pattu saree mango yellow", 22000, 1, None),
    ("CTS-DLY-ORG", "Cotton silk daily wear saree orange checks", 1650, 10, (50, 1550)),
]

# key, lead, channel, days ago, subject, text, lines [(saree type, quantity words, sku, pieces)], delivery city, state, customer kind, approve?
T_QUOTES: list[tuple[str, str, str, int, str, str, list[tuple[str, str, str, int]], str, str, str, bool]] = [
    ("q1", "ramesh", "whatsapp", 1, "Pattu sarees for Deepavali stock",
     "Namaste sir. For our Hindupur shop we need ten Dharmavaram pattu sarees in maroon with gold zari and six in bottle green with mustard border. Please send your best wholesale rate.",
     [("dharmavaram_pattu", "10 pieces", "DMV-PT-MRN", 10), ("dharmavaram_pattu", "6 pieces", "DMV-PT-GRN", 6)], "Hindupur", "AP", "new", False),
    ("q2", "manjunath", "email", 2, "Enquiry: soft silk sarees for Bengaluru",
     "Dear Sir, we are a saree retailer in Jayanagar, Bengaluru. Kindly quote for twenty Dharmavaram soft silk sarees in peacock blue, delivered to Bengaluru. Regards, Manjunath Hegde.",
     [("dharmavaram_pattu", "20 pieces", "DMV-SFT-BLU", 20)], "Bengaluru", "KA", "new", False),
    ("q3", "padmavathi", "whatsapp", 5, "Repeat order for wedding season",
     "Same as last time please: twelve maroon pattu sarees and four bridal red and gold checks for the wedding season. Send to Hindupur as usual.",
     [("dharmavaram_pattu", "12 pieces", "DMV-PT-MRN", 12), ("dharmavaram_pattu", "4 pieces", "DMV-BRD-RED", 4)], "Hindupur", "AP", "repeat", True),
    ("q4", "prakash", "form", 4, "IndiaMART enquiry: cotton silk daily wear",
     "Buyer enquiry from IndiaMART: need 50 pieces of cotton silk daily wear sarees, orange checks, for our Hyderabad shop. Please quote with delivery.",
     [("other", "50 pieces", "CTS-DLY-ORG", 50)], "Hyderabad", "TG", "new", True),
    ("q5", "prasanna", "whatsapp", 3, "Bridal sarees for my daughter's wedding",
     "Hello, my daughter's wedding is in December. I want one Dharmavaram bridal pattu in red and gold and two Kanchi pattu sarees in mango yellow for the family.",
     [("dharmavaram_pattu", "1 piece", "DMV-BRD-RED", 1), ("kanjivaram", "2 pieces", "KNC-PT-YLW", 2)], "Anantapur", "AP", "new", True),
]


def _price_list_csv() -> str:
    rows = ["sku,name,unit_price,moq,tax_bps,min_qty_1,price_1"]
    for sku, name, rupees, moq, brk in PRODUCTS:
        rows.append(f"{sku},{name},{rupees},{moq},500,{brk[0] if brk else ''},{brk[1] if brk else ''}")
    return "\n".join(rows) + "\n"


def textiles(s: Seeder) -> None:
    people = s.customers("t", T_PEOPLE, 6400)
    s.notes["customers"] = f"{len(T_PEOPLE)}: 6 WhatsApp, 4 e-mail, 4 IndiaMART, 3 walk-in, 3 website"

    # the retail catalogue: each saree hidden first, then a placeholder picture (an active item needs one), then shown; an item a person already has shown or hidden after its picture is left alone
    def saree(n: int, spec: tuple[str, str, list[str], str, str | None, list[str], str, int, str, tuple[int, int, int]]) -> None:
        name, fabric, colours, zari, border, occasions, band, price, stock, rgb = spec
        item = did(f"t-saree-{n}")
        st, current = s.get(f"/catalogue/items/{item}")
        if st == 200 and isinstance(current, dict) and (current.get("active") or current.get("photo_count")):
            s.kept["catalogue sarees"] += 1
            return
        body: dict[str, Any] = {"name": name, "fabric": fabric, "colours": colours, "zari": zari, "occasions": occasions, "price_band": band, "stock_status": stock, "price_paise": price}
        if border:
            body["border"] = border
        s.req("saree", "PUT", f"/catalogue/items/{item}", {**body, "active": False})
        s.req("saree picture", "POST", f"/catalogue/items/{item}/photos?photo_id={did(f't-saree-{n}-photo')}", raw=(placeholder_png(rgb=rgb), "image/png"))
        s.req("saree shown", "PUT", f"/catalogue/items/{item}", {**body, "active": True})
        s.made["catalogue sarees"] += 1

    for n, spec in enumerate(SAREES, start=1):
        s.piece(f"saree {n}", lambda n=n, spec=spec: saree(n, spec))  # type: ignore[misc]
    s.notes["catalogue"] = f"{len(SAREES)} sarees with a placeholder picture: {sum(1 for x in SAREES if x[8] == 'in_stock')} in stock, {sum(1 for x in SAREES if x[8] == 'few_left')} few left, {sum(1 for x in SAREES if x[8] == 'made_to_order')} made to order"

    # the wholesale products, the price list (from a CSV, like a person's upload) and the quote policy
    def wholesale() -> None:
        for sku, name, _rupees, _moq, _brk in PRODUCTS:
            s.req("product", "POST", "/products", {"id": did(f"t-product-{sku}"), "sku": sku, "name": name, "unit": "piece", "category": "saree"}, kind="products")
        st, out = s.call("POST", "/price-lists/import", {"id": did("t-price-list-1"), "csv": _price_list_csv(), "effective_from": s.today.isoformat()})
        if st in (200, 201):
            (s.made if _fresh(st, out) else s.kept)["price list"] += 1
        elif st == 409:
            s.kept["price list"] += 1  # saved on an earlier day: the same id with another date is refused, the first one stands
        else:
            raise DemoError(f"price list: HTTP {st}" + (f" ({_code(out)})" if _code(out) else ""))
        st, listed = s.get("/quote-policy-versions")
        if st == 200 and isinstance(listed, list) and listed:
            s.kept["quote policy"] += 1
            return
        s.req("quote policy", "POST", "/quote-policy-versions", {
            "id": did("t-quote-policy"), "effective_from": s.today.isoformat(), "discount_ceiling_bps": 500, "shipping_flat_fee_paise": 35_000, "validity_days": 10,
            "new_advance_bps": 5000, "repeat_advance_bps": 2500, "new_net_days": 0, "repeat_net_days": 30, "gst_rate_bps": 500, "repeat_credit_limit_paise": 50_000_000, "seller_state": "AP"}, kind="quote policy")

    s.piece("products, price list and quote policy", wholesale)
    s.notes["products"] = f"{len(PRODUCTS)} wholesale products on a price list (GST 5%), a quote policy (seller in AP, 50% advance for a new customer)"

    # enquiries -> confirmed requirement -> picks -> the engine's quote; some approved (nothing is sent: the text is rendered for a person to copy)
    quotes: dict[str, str] = {}

    def quote(spec: tuple[str, str, str, int, str, str, list[tuple[str, str, str, int]], str, str, str, bool]) -> None:
        key, who, channel, ago, subject, text, lines, city, state, kind, approve = spec
        lead = people[who]["lead"]
        eid = s.enquiry(f"t-{key}", lead, channel, s.at(ago, 11, 20), subject, text)
        qid = did(f"t-{key}-quote")
        st, q = s.get(f"/quotes/{qid}")
        if st != 200:
            fields: list[tuple[int | None, str, str]] = []
            for n, (stype, qty, _sku, _pieces) in enumerate(lines, start=1):
                fields += [(n, "saree_type", stype), (n, "quantity", qty)]
            fields.append((None, "delivery_city", city))
            s.requirement(eid, fields)
            setup = s.req("quote setup", "GET", f"/enquiries/{eid}/quote-setup")
            products = {p["sku"]: p["product_id"] for p in setup.get("price_list", [])}
            for n, (_stype, _qty, sku, pieces) in enumerate(lines, start=1):
                if sku not in products:
                    raise DemoError(f"quote {key}: the price list has no {sku} (missing: {','.join(setup.get('missing', []))})")
                s.req("pick", "POST", f"/enquiries/{eid}/picks", {"line": n, "product_id": products[sku], "qty": pieces, "sale_unit": "piece"})
            s.req("quote", "POST", f"/enquiries/{eid}/quotes", {"id": qid, "customer_kind": kind, "delivery_state": state}, kind="quotes")
            q = s.req("quote", "GET", f"/quotes/{qid}")
        else:
            s.kept["quotes"] += 1
        if approve and q.get("status") == "draft":
            done = s.req("approve quote", "POST", f"/quotes/{qid}/approve")
            if (done.get("text") or {}).get("sent_by_system") is not False and done.get("text") is not None:
                raise DemoError(f"quote {key}: the approval says the system sent something; stopping")
            s.made["quotes approved"] += 1
        quotes[key] = qid

    for spec in T_QUOTES:
        s.piece(f"quote {spec[0]}", lambda spec=spec: quote(spec))  # type: ignore[misc]
    # two more enquiries that are not quoted yet (one waits for the size, one only asked for the catalogue)
    s.piece("enquiry srinivas", lambda: s.enquiry("t-e6", people["srinivas"]["lead"], "email", s.at(2, 16, 5), "Pattu sarees: rates and catalogue",
                                                  "Sir, please send the catalogue and rates of your Dharmavaram pattu range. We may take 15 to 20 pieces after Deepavali for our Kurnool showroom."))
    s.piece("enquiry gowda", lambda: s.enquiry("t-e7", people["gowda"]["lead"], "form", s.at(1, 18, 40), "IndiaMART enquiry: Kanchi pattu",
                                               "Buyer enquiry from IndiaMART: interested in Kanchi pattu sarees for a Tumakuru showroom. Quantity to be discussed. Please call back with the price range."))

    # orders from the approved quotes (records of what happened; the advance paid is each order's own)
    s.piece("order policy", lambda: s.order_policy("t"))

    def order(key: str, qkey: str, steps: list[str]) -> None:
        if qkey not in quotes:
            raise DemoError(f"order {key}: its quote is missing")
        oid = did(f"t-{key}-order")
        if s.get(f"/orders/{oid}")[0] != 200:
            s.req("order", "POST", "/orders", {"id": oid, "quote_id": quotes[qkey]}, kind="orders")
        else:
            s.kept["orders"] += 1
        s.order_steps(f"t-{key}", oid, steps)

    s.piece("order padmavathi", lambda: order("o1", "q3", ["send_quote", "customer_accept", "request_advance", "pay_advance", "start_preparation"]))
    s.piece("order prakash", lambda: order("o2", "q4", ["send_quote", "customer_accept", "request_advance", "pay_advance", "start_preparation", "dispatch"]))
    s.piece("order prasanna", lambda: order("o3", "q5", ["send_quote"]))

    # follow-ups: the first message was sent by hand (recorded), so these are due; two have a draft waiting for the Owner
    def followups() -> None:
        s.followup_policy("t")
        for who, channel, evidence in (("suresh", "whatsapp", ("written", "whatsapp:2026-11-02")), ("nagaraju", "whatsapp", ("written", "whatsapp:2026-11-01")),
                                       ("ramana", "whatsapp", ("written", "indiamart:buylead-1102")), ("srinivas", "email", ("email_reply", "mail:2026-11-02")),
                                       ("raghavendra", "email", ("web_form", "website:form-1031"))):
            def one(who: str = who, channel: str = channel, evidence: tuple[str, str] = evidence) -> None:
                s.consent(people[who]["contact"], channel, evidence)
                s.first_message(f"t-{who}", people[who]["lead"], channel)
            s.piece(f"follow-up {who}", one)
        s.piece("draft suresh", lambda: s.followup_draft("t-suresh", people["suresh"]["lead"], "whatsapp"))
        s.piece("draft srinivas", lambda: s.followup_draft("t-srinivas", people["srinivas"]["lead"], "email"))

    s.piece("follow-ups", followups)

    # store visits ("At the store today")
    s.piece("visit saraswathi", lambda: s.visit("t-saraswathi", people["saraswathi"]["lead"], s.today, "11:30", 2, "Choosing a wedding saree for her daughter"))
    s.piece("visit jyothi", lambda: s.visit("t-jyothi", people["jyothi"]["lead"], s.today, "17:00", 3, "Bridal pattu sarees, with the family"))
    s.piece("visit deepika", lambda: s.visit("t-deepika", people["deepika"]["lead"], s.today + timedelta(days=1), "12:00", 1, "Wants to see Kanchi and Dharmavaram pattu in person"))


# ======================================================================================================== construction materials
C_PEOPLE: list[tuple[str, str, str | None, str, str, str, str | None]] = [
    # WhatsApp
    ("venkatesh", "Venkatesh Naidu", "Venkatesh Constructions", "Anantapur", "Andhra Pradesh", "whatsapp", "venkatesh.naidu"),
    ("mallikarjuna", "Mallikarjuna Reddy", None, "Anantapur", "Andhra Pradesh", "whatsapp", None),
    ("saikrishna", "Sai Krishna Yadav", "Sai Krishna Builders", "Dharmavaram", "Andhra Pradesh", "whatsapp", "saikrishna.builders"),
    ("obulesu", "Obulesu K", "Obulesu Civil Works", "Tadipatri", "Andhra Pradesh", "whatsapp", None),
    ("chandrasekhar", "Chandrasekhar Rao", "Sri Rama Hardware and Cement", "Gooty", "Andhra Pradesh", "whatsapp", None),
    ("narasimhulu", "Narasimhulu B", None, "Rapthadu", "Andhra Pradesh", "whatsapp", None),
    # e-mail
    ("ravindra", "Ravindra Kumar", "RK Infra Projects", "Anantapur", "Andhra Pradesh", "email_forward", "ravindra.kumar"),
    ("sandhya", "Sandhya Rani", "Sandhya Homes", "Hindupur", "Andhra Pradesh", "email_forward", "sandhya.rani"),
    ("praveen", "Praveen Kumar Jain", "Jain Builders", "Kurnool", "Andhra Pradesh", "email_forward", "praveen.jain"),
    # IndiaMART
    ("basha", "Khaja Basha", "Basha Tiles and Pavers", "Kadiri", "Andhra Pradesh", "indiamart", None),
    ("nagendra", "Nagendra Prasad", "Prasad Developers", "Kalyandurg", "Andhra Pradesh", "indiamart", "nagendra.prasad"),
    ("imran", "Imran Khan", "Khan Landscaping", "Bengaluru", "Karnataka", "indiamart", "imran.khan"),
    ("ramanjaneyulu", "Ramanjaneyulu G", "Anjaneya Builders", "Guntakal", "Andhra Pradesh", "indiamart", None),
    # walk-in
    ("subbareddy", "Subba Reddy", None, "Anantapur", "Andhra Pradesh", "walk_in", None),
    ("gangadhar", "Gangadhar M", "Gangadhar Constructions", "Penukonda", "Andhra Pradesh", "walk_in", None),
    ("lakshmidevi", "Lakshmidevi P", None, "Anantapur", "Andhra Pradesh", "walk_in", None),
    ("rajasekhar", "Rajasekhar S", "RS Engineers", "Anantapur", "Andhra Pradesh", "walk_in", "rajasekhar.rs"),
    # website
    ("srikanth", "Srikanth Varma", "Srikanth Associates, Architects", "Anantapur", "Andhra Pradesh", "website_form", "srikanth.varma"),
    ("divya", "Divya Teja", None, "Puttaparthi", "Andhra Pradesh", "website_form", "divya.teja"),
    ("harsha", "Harsha Vardhan", "HV Projects", "Hindupur", "Andhra Pradesh", "website_form", "harsha.vardhan"),
]

# key, name, sold per, area unit, stock, price (paise per selling unit), custom values, placeholder colour
MATERIALS: list[tuple[str, str, str, str | None, str, int, dict[str, Any], tuple[int, int, int]]] = [
    ("opc53", "OPC 53 grade cement, 50 kg bag", "bag", None, "in_stock", 38_500, {"product_type": "cement", "grade": "OPC 53", "hsn_code": "25232930", "gst_rate_percent": 18, "minimum_order": 10, "lead_days": 1}, (150, 150, 150)),
    ("ppc", "PPC cement, 50 kg bag", "bag", None, "in_stock", 36_000, {"product_type": "cement", "grade": "PPC", "hsn_code": "25232930", "gst_rate_percent": 18, "minimum_order": 10, "lead_days": 1}, (170, 165, 160)),
    ("tmt12", "TMT steel bars Fe 500D, 12 mm", "tonne", None, "in_stock", 6_450_000, {"product_type": "other", "grade": "Fe 500D", "size": "12 mm", "hsn_code": "72142090", "gst_rate_percent": 18, "lead_days": 2}, (70, 70, 80)),
    ("tmt8", "TMT steel bars Fe 500D, 8 mm", "tonne", None, "few_left", 6_600_000, {"product_type": "other", "grade": "Fe 500D", "size": "8 mm", "hsn_code": "72142090", "gst_rate_percent": 18, "lead_days": 2}, (90, 85, 90)),
    ("paver80", "Zig-zag paver block, 80 mm, grey", "sq_ft", "sq_ft", "in_stock", 6_200, {"product_type": "paver_block", "thickness_mm": "80", "size": "225 x 112.5 mm", "shape_pattern": "Zig-zag", "colour": "Grey",
                                                                                     "pieces_per_area": 4, "pieces_per_pallet": 400, "minimum_order": 200, "lead_days": 3, "hsn_code": "68101190", "gst_rate_percent": 18}, (120, 120, 125)),
    ("paver60", "I-shape paver block, 60 mm, red", "sq_ft", "sq_ft", "in_stock", 4_800, {"product_type": "paver_block", "thickness_mm": "60", "size": "200 x 165 mm", "shape_pattern": "I-shape", "colour": "Red",
                                                                                   "pieces_per_area": 3.4, "pieces_per_pallet": 450, "minimum_order": 200, "lead_days": 3, "hsn_code": "68101190", "gst_rate_percent": 18}, (160, 60, 50)),
    ("kerb", "Kerb stone 450 x 300 x 150 mm", "piece", None, "made_to_order", 9_500, {"product_type": "kerb_stone", "size": "450 x 300 x 150 mm", "minimum_order": 50, "lead_days": 7, "hsn_code": "68101990", "gst_rate_percent": 18}, (180, 180, 175)),
    ("flyash", "Fly ash brick 230 x 110 x 75 mm", "piece", None, "in_stock", 750, {"product_type": "brick", "size": "230 x 110 x 75 mm", "minimum_order": 1000, "lead_days": 2, "hsn_code": "68159990", "gst_rate_percent": 5}, (140, 140, 130)),
    ("msand", "M-sand, plastering grade", "cft", None, "in_stock", 5_500, {"product_type": "sand", "grade": "Plastering", "hsn_code": "25059000", "gst_rate_percent": 5, "minimum_order": 100, "lead_days": 1}, (200, 170, 120)),
]

# key, lead, channel, days ago, subject, text, lines [(product words, measure field, measure words, item key)], site, application or None, approve?
C_QUOTES: list[tuple[str, str, str, int, str, str, list[tuple[str, str, str, str]], str, str | None, bool]] = [
    ("mq1", "venkatesh", "whatsapp", 6, "Paver blocks for a compound and driveway",
     "Sir, we need 80 mm zig-zag paver blocks, grey, for a 2400 sq ft driveway and compound at Sai Nagar. Supply only, our own labour will lay. Please send the rate with transport.",
     [("paver block", "area", "2400 sq ft", "paver80")], "Sai Nagar, Anantapur", "driveway", True),
    ("mq2", "saikrishna", "whatsapp", 5, "Cement and steel for G+2 building",
     "Need 300 bags OPC 53 cement and 4 tonnes of 12 mm TMT bars for our G+2 site at Dharmavaram. Please quote with delivery.",
     [("cement", "quantity", "300 bags", "opc53"), ("TMT steel bars", "quantity", "4 tonnes", "tmt12")], "Kothapeta, Dharmavaram", None, True),
    ("mq3", "ravindra", "email", 4, "Fly ash bricks for the Rudrampeta apartment project",
     "Dear Sir, please quote for 8000 fly ash bricks for our apartment project at Rudrampeta. Delivery in two lots is fine. Regards, Ravindra Kumar, RK Infra Projects.",
     [("fly ash bricks", "quantity", "8000 pieces", "flyash")], "Rudrampeta, Anantapur", None, True),
    ("mq4", "mallikarjuna", "whatsapp", 1, "Cement and steel for my house",
     "Namaskaram sir, building my house at Kamalanagar. Need 120 bags PPC cement and 1 tonne of 8 mm steel. What is the rate with delivery?",
     [("cement", "quantity", "120 bags", "ppc"), ("TMT steel bars", "quantity", "1 tonne", "tmt8")], "Kamalanagar, Anantapur", None, False),
    ("mq5", "nagendra", "form", 2, "IndiaMART enquiry: kerb stones and pavers for a layout road",
     "Buyer enquiry from IndiaMART: 400 kerb stones and red I-shape paver blocks 60 mm for 1500 sq ft of footpath in our Kalyandurg layout. Please quote.",
     [("kerb stone", "quantity", "400 pieces", "kerb"), ("paver block", "area", "1500 sq ft", "paver60")], "Venkatadri Layout, Kalyandurg", "footpath", False),
    ("mq6", "subbareddy", "other", 6, "Walk-in: paver blocks for the house front",
     "Walk-in customer: wants red I-shape paver blocks, 60 mm, for 900 sq ft in front of his house in Housing Board Colony. Supply only.",
     [("paver block", "area", "900 sq ft", "paver60")], "Housing Board Colony, Anantapur", "driveway", True),
]


def construction(s: Seeder) -> None:
    # the materials rules (the pack's worked example, without laying: a truck of 2,500 pieces at Rs 3,500 a trip, 5% wastage, 50% advance, valid 7 days), only when the workspace has none
    def policy() -> None:
        current = s.req("materials policy", "GET", "/materials/policy").get("current")
        if current is not None:
            s.kept["materials policy"] += 1
            return
        vectors = json.loads((ROOT / "packages/quote-engine/tests/fixtures/construction_vectors.json").read_text(encoding="utf-8"))["vectors"]
        rules = next(v for v in vectors if v["name"].startswith("worked_example"))["request"]["policy"]
        s.req("materials policy", "POST", "/materials/policy", {"version_id": did("c-materials-policy"), "policy": {k: v for k, v in rules.items() if k != "laying"}}, kind="materials policy")

    s.piece("materials policy", policy)

    # the products: hidden, their figures, a placeholder picture, then shown (an active product needs one); a product a person already shows or hid after its picture is left as it is
    items: dict[str, str] = {}

    def material(spec: tuple[str, str, str, str | None, str, int, dict[str, Any], tuple[int, int, int]]) -> None:
        key, name, unit, area_unit, stock, price, custom, rgb = spec
        item = did(f"c-item-{key}")
        items[key] = item
        st, current = s.get(f"/materials/items/{item}")
        if st == 200 and isinstance(current, dict) and (current.get("active") or current.get("photos")):
            s.kept["products"] += 1
            return
        body: dict[str, Any] = {"name": name, "sell_unit": unit, "stock_status": stock, "price_paise": price}
        if area_unit:
            body["area_unit"] = area_unit
        if st != 200:
            s.req("product", "PUT", f"/materials/items/{item}", {**body, "active": False})
            s.req("product figures", "PUT", f"/catalogue/{item}/custom", {"values": custom})
        s.req("product picture", "POST", f"/materials/items/{item}/photos?photo_id={did(f'c-item-{key}-photo')}", raw=(placeholder_png(rgb=rgb), "image/png"))
        s.req("product shown", "PUT", f"/materials/items/{item}", {**body, "active": True})
        s.made["products"] += 1

    for spec in MATERIALS:
        s.piece(f"product {spec[0]}", lambda spec=spec: material(spec))  # type: ignore[misc]
    s.notes["products"] = f"{len(MATERIALS)} (cement, TMT steel, paver blocks, kerb stones, fly ash bricks, M-sand), each with price, GST and a placeholder picture; stock: " + ", ".join(
        f"{sum(1 for m in MATERIALS if m[4] == k)} {k.replace('_', ' ')}" for k in ("in_stock", "few_left", "made_to_order"))

    people = s.customers("c", C_PEOPLE, 6500)
    s.notes["customers"] = f"{len(C_PEOPLE)}: 6 WhatsApp, 3 e-mail, 4 IndiaMART, 4 walk-in, 3 website"

    # enquiries -> confirmed requirement -> the calculator's material quote (the database computes it again); four approved, two left waiting
    mquotes: dict[str, dict[str, Any]] = {}

    def mquote(spec: tuple[str, str, str, int, str, str, list[tuple[str, str, str, str]], str, str | None, bool]) -> None:
        key, who, channel, ago, subject, text, lines, site, application, approve = spec
        eid = s.enquiry(f"c-{key}", people[who]["lead"], channel, s.at(ago, 10, 15), subject, text)
        qid = did(f"c-{key}-quote")
        st, q = s.get(f"/materials/quotes/{qid}")
        if st != 200:
            fields: list[tuple[int | None, str, str]] = []
            for n, (product, measure, words, _item) in enumerate(lines, start=1):
                fields += [(n, "product_type", product), (n, measure, words)]
            fields.append((None, "site_location", site))
            if application:
                fields.append((None, "application", application))
            if any(x[1] == "area" for x in lines):
                fields.append((None, "laying", "supply only"))
            rid = s.requirement(eid, fields)
            if rid is None:
                raise DemoError(f"material quote {key}: no requirement")
            picks = [{"line_no": n, "item_id": items[x[3]]} for n, x in enumerate(lines, start=1)]
            s.req("material quote", "POST", f"/materials/requirements/{rid}/quotes", {"quote_id": qid, "picks": picks}, kind="material quotes")
            q = s.req("material quote", "GET", f"/materials/quotes/{qid}")
        else:
            s.kept["material quotes"] += 1
        if approve and q.get("status") == "draft":
            s.req("approve material quote", "POST", f"/materials/quotes/{qid}/approve")
            s.made["material quotes approved"] += 1
            q = s.req("material quote", "GET", f"/materials/quotes/{qid}")
        mquotes[key] = q

    for spec in C_QUOTES:
        s.piece(f"material quote {spec[0]}", lambda spec=spec: mquote(spec))  # type: ignore[misc]

    # orders (records of what happened), trips, the balance invoice
    s.piece("order policy", lambda: s.order_policy("c"))
    orders: dict[str, dict[str, Any]] = {}

    def morder(key: str, qkey: str, steps: list[str]) -> None:
        if qkey not in mquotes or mquotes[qkey].get("status") != "approved":
            raise DemoError(f"order {key}: its quote is not approved")
        oid = did(f"c-{key}-order")
        if s.get(f"/orders/{oid}")[0] != 200:
            s.req("order", "POST", f"/materials/quotes/{mquotes[qkey]['id']}/order", {"order_id": oid}, kind="orders")
        else:
            s.kept["orders"] += 1
        orders[key] = s.order_steps(f"c-{key}", oid, steps)

    upto_dispatch = ["send_quote", "customer_accept", "request_advance", "pay_advance", "start_preparation", "dispatch"]
    s.piece("order venkatesh", lambda: morder("o1", "mq1", [*upto_dispatch, "deliver"]))
    s.piece("order saikrishna", lambda: morder("o2", "mq2", upto_dispatch))
    s.piece("order ravindra", lambda: morder("o3", "mq3", upto_dispatch[:5]))
    # the customer paid the advance and then cancelled (the Owner records it): the order still holds the advance, so Today asks about a refund
    s.piece("order subbareddy", lambda: morder("o4", "mq6", ["send_quote", "customer_accept", "request_advance", "pay_advance", "cancel"]))

    def trip(key: str, okey: str, status_path: list[str], vehicle: str, driver: str, phone: str, share: int | None) -> None:
        if okey not in orders:
            raise DemoError(f"trip {key}: its order is missing")
        tid = did(f"c-{key}-trip")
        st, current = s.get(f"/trips/{tid}")
        if st != 200:
            quote = mquotes[{"o2": "mq2", "o3": "mq3"}[okey]]
            lines = []
            for ln in quote.get("lines", []):
                qty = int(ln["pieces"] if ln.get("pieces") else ln["billed_quantity"])
                lines.append({"line_no": int(ln["line_no"]), "quantity": min(qty, share) if share else qty})
            current = s.req("trip", "POST", f"/orders/{orders[okey]['id']}/trips", {"trip_id": tid, "planned_date": s.today.isoformat(), "vehicle_no": vehicle, "driver_name": driver,
                                                                                  "driver_phone": phone, "lines": lines}, kind="trips today")
        else:
            s.kept["trips today"] += 1
        for status in status_path:  # only forward, and only from where a person has not taken it
            order = ["planned", "loaded", "on_the_way"]
            now = current.get("status")
            if now in order and order.index(now) < order.index(status):
                current = s.req("trip status", "POST", f"/trips/{tid}/status", {"status": status})

    s.piece("trip saikrishna", lambda: trip("t1", "o2", ["loaded", "on_the_way"], "AP 02 TC 4417", "Ramanjaneya", "+00 000 000 6591", None))
    s.piece("trip ravindra", lambda: trip("t2", "o3", [], "AP 39 TB 2286", "Hussain Basha", "+00 000 000 6592", 2500))

    def invoice() -> None:
        if "o1" not in orders:
            raise DemoError("invoice: the delivered order is missing")
        inv = did("c-o1-invoice")
        st, ledger = s.get(f"/dues/customers/{people['venkatesh']['company']}/ledger")
        if st == 200 and str(inv) in json.dumps(ledger):
            s.kept["invoices"] += 1
            return
        balance = int(orders["o1"]["balance_paise"])  # the order's own figure: what is still to be paid after the advance
        if balance <= 0:
            return
        s.req("invoice", "PUT", f"/dues/invoices/{inv}", {"company_id": people["venkatesh"]["company"], "invoice_no": "SSC/26-27/0418", "invoice_date": s.today.isoformat(),
                                                           "due_date": (s.today + timedelta(days=5)).isoformat(), "amount_paise": balance, "order_id": orders["o1"]["id"]}, ok=(200, 201, 409), kind="invoices")

    s.piece("balance invoice", invoice)

    # follow-ups due (the first message was sent by hand and recorded). No drafts here: the app's follow-up wordings speak of a saree requirement, which a cement shop would not send.
    def followups() -> None:
        s.followup_policy("c")
        for who, channel, evidence in (("obulesu", "whatsapp", ("written", "whatsapp:2026-11-02")), ("chandrasekhar", "whatsapp", ("written", "whatsapp:2026-11-01")),
                                       ("sandhya", "email", ("email_reply", "mail:2026-10-31")), ("imran", "email", ("web_form", "indiamart:buylead-1101")),
                                       ("srikanth", "email", ("web_form", "website:form-1102"))):
            def one(who: str = who, channel: str = channel, evidence: tuple[str, str] = evidence) -> None:
                s.consent(people[who]["contact"], channel, evidence)
                s.first_message(f"c-{who}", people[who]["lead"], channel)
            s.piece(f"follow-up {who}", one)

    s.piece("follow-ups", followups)

    s.piece("call basha", lambda: s.call_request("c-basha", people["basha"]["lead"], "Asked on IndiaMART for 60 mm pavers for a showroom yard: confirm the area and the site address",
                                                 "Namaste, this is Sri Sai Cements, Anantapur. You asked about paver blocks for your showroom yard. Could you tell us the area in square feet and the site address, so we can send a quote?"))
    s.piece("call gangadhar", lambda: s.call_request("c-gangadhar", people["gangadhar"]["lead"], "Came to the shop for 150 bags of PPC on credit: discuss the credit terms before quoting",
                                                     "Namaste, this is Sri Sai Cements. You visited us about 150 bags of PPC cement. Before we quote, can we talk about the credit period you need?", "te"))


# ======================================================================================================== education
CLASSES: list[tuple[str, str, int, int]] = [
    # key, name, tuition per term (paise), books (paise)
    ("c1", "Class 1", 850_000, 240_000),
    ("c4", "Class 4", 950_000, 290_000),
    ("c7", "Class 7", 1_100_000, 360_000),
    ("c10", "Class 10", 1_350_000, 420_000),
]
# key, class, section, child's first name, guardian, admission no, term-2 paid: "full" | "part" | "today" | "none"
STUDENTS: list[tuple[str, str, str, str, str, str, str]] = [
    ("s01", "c1", "A", "Harshitha", "Srinivasulu Reddy", "VPS/2026/101", "full"),
    ("s02", "c1", "A", "Charan", "Madhavi Latha", "VPS/2026/102", "none"),
    ("s03", "c1", "B", "Sathvika", "Ramesh Babu", "VPS/2026/103", "full"),
    ("s04", "c1", "B", "Aarav", "Shaik Mahaboob", "VPS/2026/104", "today"),
    ("s05", "c4", "A", "Pranavi", "Venkata Lakshmi", "VPS/2023/211", "full"),
    ("s06", "c4", "A", "Yashwanth", "Narayana Swamy", "VPS/2023/212", "part"),
    ("s07", "c4", "B", "Keerthana", "Sudhakar Naidu", "VPS/2023/213", "none"),
    ("s08", "c4", "B", "Rithvik", "Anjali Devi", "VPS/2023/214", "full"),
    ("s09", "c7", "A", "Bhavya", "Ravi Shankar", "VPS/2020/305", "full"),
    ("s10", "c7", "A", "Mokshith", "Jayamma", "VPS/2020/306", "today"),
    ("s11", "c7", "B", "Sri Vidya", "Prabhakar Rao", "VPS/2020/307", "none"),
    ("s12", "c7", "B", "Tarun", "Hemalatha", "VPS/2020/308", "full"),
    ("s13", "c10", "A", "Deekshitha", "Chandra Mohan", "VPS/2017/402", "full"),
    ("s14", "c10", "A", "Karthikeya", "Saraswathi Bai", "VPS/2017/403", "part"),
    ("s15", "c10", "B", "Nikhitha", "Govindappa", "VPS/2017/404", "none"),
    ("s16", "c10", "B", "Sai Teja", "Rukmini Devi", "VPS/2017/405", "full"),
]
# key, guardian, phone number offset, source, class, stage, lost reason
ADMISSIONS: list[tuple[str, str, int, str, str, str, str | None]] = [
    ("a1", "Prasanna Kumar", 31, "whatsapp", "c1", "campus_visit", None),
    ("a2", "Anitha Rani", 32, "walk_in", "c4", "application", None),
    ("a3", "Mahaboob Basha", 33, "website", "c7", "enquiry", None),
    ("a4", "Revathi Naidu", 34, "referral", "c1", "campus_visit", None),
    ("a5", "Gopala Krishna", 35, "whatsapp", "c10", "enquiry", None),
    ("a6", "Sailaja M", 36, "ad", "c4", "lost", "distance"),
    ("a7", "Venugopal Reddy", 37, "whatsapp", "c7", "application", None),
    ("a8", "Shabana Begum", 38, "walk_in", "c1", "enquiry", None),
    ("a9", "Ramakrishna Setty", 39, "website", "c10", "enquiry", None),
]


def education(s: Seeder) -> None:
    year = academic_year(s.today)
    start = int(year[:4])
    term_due = [date(start, 6, 15), date(start, 10, 15), date(start + 1, 1, 15)]

    def profile() -> None:
        st, prof = s.get(f"{INST}/profile")
        if st == 200 and isinstance(prof, dict) and prof.get("configured"):
            s.kept["school profile"] += 1
            return
        s.req("school profile", "PUT", f"{INST}/profile", {"institution_type": "school", "year_start_month": 6, "parent_languages": ["te", "en"],
                                                        "terms": [{"label": "Term 1", "start_month": 6, "end_month": 9}, {"label": "Term 2", "start_month": 10, "end_month": 12},
                                                                  {"label": "Term 3", "start_month": 1, "end_month": 4}]})
        s.made["school profile"] += 1

    s.piece("school profile", profile)

    # classes with sections A and B (made only when absent: a renamed class is never renamed back)
    groups: dict[tuple[str, str], str] = {}

    def classes() -> None:
        st, listed = s.get(f"{INST}/programmes")
        have = {str(p["id"]): {str(g["id"]) for g in p.get("groups", [])} for p in (listed.get("items", []) if st == 200 and isinstance(listed, dict) else [])}
        for key, name, _tuition, _books in CLASSES:
            pid = did(f"e-{key}")
            if pid not in have:
                s.req("class", "PUT", f"{INST}/programmes/{pid}", {"name": name, "kind": "class", "group_kind": "section", "active": True}, kind="classes")
            else:
                s.kept["classes"] += 1
            for section in ("A", "B"):
                gid = did(f"e-{key}-{section}")
                groups[(key, section)] = gid
                if gid not in have.get(pid, set()):
                    s.req("section", "PUT", f"{INST}/programmes/{pid}/groups/{gid}", {"label": section, "active": True}, kind="sections")

    s.piece("classes", classes)

    # fee plans for the year: three terms of tuition and the books in June; a fixed late fee of Rs 250 after ten days (posted only by a person)
    def plans() -> None:
        for key, name, tuition, books in CLASSES:
            plan = did(f"e-{key}-plan-{year}")
            if s.get(f"{INST}/fee-plans/{plan}")[0] == 200:
                s.kept["fee plans"] += 1
                continue
            lines = [{"head": "tuition", "instalment_no": n, "due_date": d.isoformat(), "amount_paise": tuition} for n, d in enumerate(term_due, start=1)]
            lines.append({"head": "books", "instalment_no": 1, "due_date": term_due[0].isoformat(), "amount_paise": books})
            s.req("fee plan", "PUT", f"{INST}/fee-plans/{plan}", {"name": f"{name} fees {year}", "programme_id": did(f"e-{key}"), "academic_year": year, "late_fee_kind": "fixed",
                                                              "late_fee_paise": 25_000, "late_fee_grace_days": 10, "lines": lines})
            s.made["fee plans"] += 1  # the answer carries no created flag: it was absent a moment ago

    s.piece("fee plans", plans)

    fees = {key: (tuition, books) for key, _n, tuition, books in CLASSES}

    def student(n: int, spec: tuple[str, str, str, str, str, str, str]) -> None:
        key, klass, section, child, guardian, adm_no, term2 = spec
        contact, sid = did(f"e-{key}-guardian"), did(f"e-{key}")
        s.row("contacts", {"id": contact, "full_name": guardian, "phone": f"+00 000 000 {6600 + n}"}, "guardians")
        if s.get(f"{INST}/students/{sid}")[0] != 200:
            s.req("student", "PUT", f"{INST}/students/{sid}", {"contact_id": contact, "is_adult": False, "child_label": child, "programme_id": did(f"e-{klass}"),
                                                           "group_id": groups.get((klass, section)), "admission_no": adm_no, "joined_on": date(int(adm_no[4:8]), 6, 1).isoformat()}, kind="students")
        else:
            s.kept["students"] += 1
        statement = s.req("fee statement", "GET", f"{INST}/students/{sid}/fees")
        if statement.get("assignment") is None:
            s.req("fee assignment", "PUT", f"{INST}/fee-assignments/{did(f'e-{key}-assignment-{year}')}", {"student_id": sid, "plan_id": did(f"e-{klass}-plan-{year}"),
                                                                                                    "assigned_on": date(start, 6, 1).isoformat()}, kind="fee assignments")
        entries = s.req("fee entries", "GET", f"{INST}/students/{sid}/fees/entries")
        have = {str(e["id"]) for e in entries.get("entries", [])}
        tuition, books = fees[klass]
        pays: list[tuple[str, date, int, str]] = [("t1", term_due[0] - timedelta(days=4 + n % 6), tuition, "upi"), ("books", term_due[0] - timedelta(days=4 + n % 6), books, "cash")]
        if term2 == "full":
            pays.append(("t2", term_due[1] - timedelta(days=n % 5), tuition, "upi" if n % 2 else "bank_transfer"))
        elif term2 == "part":
            pays.append(("t2", term_due[1] + timedelta(days=3), 500_000, "cash"))
        elif term2 == "today":
            pays.append(("t2", s.today, tuition, "upi"))
        for label, on, amount, method in pays:
            entry = did(f"e-{key}-payment-{label}-{year}")
            if entry in have or on > s.today:
                continue
            s.req("payment", "PUT", f"{INST}/students/{sid}/payments/{entry}", {"received_on": on.isoformat(), "amount_paise": amount, "method": method}, ok=(200, 201, 409), kind="payments")

    for n, spec in enumerate(STUDENTS, start=1):
        s.piece(f"student {spec[0]}", lambda n=n, spec=spec: student(n, spec))  # type: ignore[misc]
    s.notes["students"] = (f"{len(STUDENTS)} in {len(CLASSES)} classes (sections A and B), a guardian each (fake +00 numbers); Term 1 and books paid by all; Term 2 (due {term_due[1].isoformat()}): "
                           f"{sum(1 for x in STUDENTS if x[6] == 'full')} paid, {sum(1 for x in STUDENTS if x[6] == 'part')} part-paid, {sum(1 for x in STUDENTS if x[6] == 'today')} paid today, "
                           f"{sum(1 for x in STUDENTS if x[6] == 'none')} not paid (overdue)")

    # admission enquiries (an enquiry makes a lead of the parent; no outreach): moved to their stage once, only while they are still at the first stage
    leads: dict[str, str] = {}

    def admission(spec: tuple[str, str, int, str, str, str, str | None]) -> None:
        key, guardian, offset, source, klass, stage, lost = spec
        aid = did(f"e-{key}")
        st, current = s.get(f"{INST}/admissions/{aid}")
        if st != 200:
            current = s.req("admission", "PUT", f"{INST}/admissions/{aid}", {"source": source, "programme_id": did(f"e-{klass}"), "guardian_name": guardian,
                                                                         "guardian_phone": f"+00 000 000 {6600 + offset}"}, kind=f"admission enquiries ({source})")
        else:
            s.kept[f"admission enquiries ({source})"] += 1
        leads[key] = str(current["lead_id"])
        # Today names a waiting item by the lead's company; the admission flow makes that company with a placeholder name ("Enquiry 1a2b3c", the first characters of its id). The placeholder is
        # renamed to the parent's name (what the app's own "new customer" form does for a person without a shop), only while it still carries that exact placeholder: a person's name is never replaced.
        company_id = s.req("admission lead", "GET", f"/leads/{leads[key]}").get("company_id")
        if company_id:
            company = s.req("admission family", "GET", f"/companies/{company_id}")
            if company.get("name") == f"Enquiry {str(company_id)[:6]}":
                s.req("admission family", "PATCH", f"/companies/{company_id}", {"name": guardian, "city": "Anantapur", "region": "Andhra Pradesh"})
                s.made["families named"] += 1
            else:
                s.kept["families named"] += 1
        if stage != "enquiry" and current.get("stage") == "enquiry":
            body: dict[str, Any] = {"stage": stage}
            if lost:
                body["lost_reason"] = lost
            s.req("admission stage", "POST", f"{INST}/admissions/{aid}/stage", body)

    for spec in ADMISSIONS:
        s.piece(f"admission {spec[0]}", lambda spec=spec: admission(spec))  # type: ignore[misc]
    s.notes["admissions"] = f"{len(ADMISSIONS)} enquiries: " + ", ".join(f"{sum(1 for a in ADMISSIONS if a[5] == st)} {st.replace('_', ' ')}" for st in ("enquiry", "campus_visit", "application", "lost"))

    def needs_lead(key: str) -> str:
        if key not in leads:
            raise DemoError(f"admission {key} is missing")
        return leads[key]

    s.piece("campus visit a1", lambda: s.visit("e-a1", needs_lead("a1"), s.today, "10:30", 3, "Campus visit for Class 1 admission: parents and the child"))
    s.piece("campus visit a4", lambda: s.visit("e-a4", needs_lead("a4"), s.today, "15:00", 2, "Campus visit for Class 1: wants to see the classrooms and the bus route"))
    s.piece("call a5", lambda: s.call_request("e-a5", needs_lead("a5"), "Asked about Class 10 admission and the school bus from Rudrampeta: call back with the bus timing",
                                              "Namaskaram, this is Vidya Public School, Anantapur. You asked about Class 10 admission and the school bus. The bus from Rudrampeta leaves at 7:40 am. Would you like to visit the school?", "te"))
    s.piece("call a8", lambda: s.call_request("e-a8", needs_lead("a8"), "Walked in about Class 1 admission: call to fix a day for the campus visit",
                                              "Namaste, this is Vidya Public School. Thank you for visiting us about Class 1 admission. Which day this week suits you for a campus visit with your child?"))

    # a fee reminder for Term 2, prepared from the ledger and LEFT AS A DRAFT (nothing goes until the Owner reads the samples and approves it)
    def reminder() -> None:
        cid = did(f"e-fee-reminder-term2-{year}")
        if s.get(f"/campaigns/{cid}")[0] == 200:
            s.kept["fee reminders (draft)"] += 1
            return
        s.req("fee reminder", "PUT", f"/campaigns/{cid}", {"name": f"Term 2 fee reminder {year}", "kind": "fee_due", "language": "en",
                                                         "message_text": "Dear {{name}}, this is a reminder from {{business}}: the Term 2 fee of {{amount}} was due on {{due_date}}. Please pay at the school office or by UPI. Thank you.",
                                                         "steps": [{"offset_days": 0, "time": "10:00"}, {"offset_days": 7, "time": "10:00"}]}, kind="fee reminders (draft)")
        added = s.req("fee reminder list", "POST", f"/campaigns/{cid}/recipients/from-ledger", {"due_from": term_due[1].isoformat(), "due_to": s.today.isoformat(), "party": "student"})
        s.notes["fee reminder"] = f"draft, not approved; {added.get('recipients')} families on its list"

    s.piece("fee reminder", reminder)


# ======================================================================================================== the entry point
def seed(pack: str, call: Call) -> dict[str, str]:
    today = datetime.now(IST).date()
    s = Seeder(call, pack, today)
    if pack == "textiles":
        textiles(s)
    elif pack == "construction_materials":
        construction(s)
    elif pack == "education":
        education(s)
    else:
        raise DemoError(f"no week of data for the pack {pack}")
    return s.summary()
