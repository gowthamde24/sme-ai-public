"""make staging-smoke: the API half of the staging smoke test (job DC). The browser half is e2e/staging-smoke.mjs (sign in, second factor, Today, sign out).

Signs in as each synthetic demo owner made by scripts/seed_staging.py (password and authenticator secret read from Google Secret Manager into memory; never printed) and, through the
DEPLOYED API under row-level security exactly like a person, runs:
  * textiles:               one manual quote (item type, quote policy, an enquiry on an example lead, a draft, approval with the second factor)
  * construction_materials: one materials quote (policy, item, enquiry, requirement fields, confirm, preview, draft, approval) and one reminder campaign (preview, approval)
  * education:              one fee reminder campaign (preview, approval); the pack has no quote module (checked, not assumed)
Every row it makes is named "Smoke test ... (synthetic)" with a fixed id, so a second run replays and adds nothing. It sends nothing to anyone: the only channel is the fake one, and the
operator's sending switch is OFF unless you turned it on.

Run: python3 scripts/staging_smoke_api.py --i-know-this-is-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api>
Exit 0 = no FAIL.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
NS = uuid.UUID("7b1d2c3e-5f40-4a6b-9c8d-0e1f2a3b4c5d")
IST = timezone(timedelta(hours=5, minutes=30))
RESULTS: list[tuple[str, str, str]] = []


def sid(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def record(name: str, status: str, note: str = "") -> None:
    RESULTS.append((name, status, note))
    print(f"{status:<5} {name} :: {note}")


class Owner:
    def __init__(self, s: ss.Seeder, pack: str) -> None:
        self.s, self.pack = s, pack
        email = f"demo-{pack.replace('_', '-')}@{ss.DEMO_DOMAIN}"
        password = ss.secret_get(f"sme-demo-{pack}-password")
        if password is None:
            raise ss.SeedError(f"no stored password for {pack}: run scripts/seed_staging.py first")
        self.token = s.second_factor(pack, s.sign_in(email, password))
        st, setup = s.call(self.token, "GET", "/v1/account/setup")
        if st != 200 or setup.get("state") != "done":
            raise ss.SeedError(f"{pack}: the workspace is not set up")
        self.t = f"/v1/tenants/{setup['tenant_id']}"

    def call(self, method: str, path: str, body: Any = None) -> tuple[int, Any]:
        return self.s.call(self.token, method, f"{self.t}{path}", body)

    def ok(self, label: str, method: str, path: str, body: Any = None, want: tuple[int, ...] = (200, 201)) -> Any:
        st, out = self.call(method, path, body)
        if st not in want:
            code = out.get("error", {}).get("code") if isinstance(out, dict) and isinstance(out.get("error"), dict) else None
            raise ss.SeedError(f"{label}: HTTP {st}" + (f" ({code})" if code else ""))
        return out


def first_lead(o: Owner) -> str:
    leads = o.ok("list leads", "GET", "/leads?limit=1")
    items = leads["items"] if isinstance(leads, dict) else leads
    if not items:
        raise ss.SeedError("no example lead to put an enquiry on")
    return str(items[0]["id"])


def textiles_quote(o: Owner) -> None:
    code = "SMK-01"
    o.ok("item type", "PUT", f"/item-types/{code}", {"name": "Smoke test piece (synthetic)", "position": 1, "active": True, "min_price_paise": 50_000, "max_price_paise": 500_000})
    policies = o.ok("policies", "GET", "/quote-policy-versions")
    if not policies:
        o.ok("policy", "POST", "/quote-policy-versions", {
            "id": sid("tx-policy"), "effective_from": datetime.now(IST).date().isoformat(), "discount_ceiling_bps": 500, "shipping_flat_fee_paise": 0, "validity_days": 15,
            "new_advance_bps": 5000, "repeat_advance_bps": 2500, "new_net_days": 0, "repeat_net_days": 30,
            "gst_rate_bps": 500,  # DEMO VALUE ONLY, as in seed_demo_manual.py: the product has no default GST rate
            "seller_state": "TG"})
    # a quote carries its date (India's day), so an identical retry is a replay only on the same day: one quote per day
    lead, enquiry, quote = first_lead(o), sid("tx-enquiry"), sid(f"tx-quote-{datetime.now(IST).date()}")
    o.ok("enquiry", "POST", f"/leads/{lead}/enquiries", {"id": enquiry, "channel": "other", "received_at": "2026-10-01T09:00:00Z", "subject": "Smoke test enquiry (synthetic)", "text": "Smoke test: 10 pieces please (synthetic)."}, want=(200, 201, 409))
    o.ok("manual quote", "POST", f"/enquiries/{enquiry}/manual-quotes", {"id": quote, "customer_kind": "new", "lines": [{"item_type_code": code, "qty": 10, "unit_price_paise": 120_000}]}, want=(200, 201))
    done = o.ok("approve quote", "POST", f"/quotes/{quote}/approve")
    record("textiles: one quote drafted and approved (second factor)", "PASS", f"status={done.get('status')}, customer text {'rendered' if done.get('text') else 'not rendered: ' + str(done.get('text_error'))}")


def construction_quote(o: Owner) -> None:
    vectors = json.loads((ROOT / "packages/quote-engine/tests/fixtures/construction_vectors.json").read_text(encoding="utf-8"))["vectors"]
    policy = next(v for v in vectors if v["name"].startswith("worked_example"))["request"]["policy"]
    policy = {k: v for k, v in policy.items() if k != "laying"}  # no laying asked in this enquiry, so no laying rule is needed
    # the smoke test uses its OWN hidden item: the demo product (scripts/demo_data.py) is shown to customers and must never be touched by a test (DG found this script re-writing the one product on every run)
    item, enquiry, req_quote = sid("cm-smoke-item"), sid("cm-enquiry"), sid(f"cm-quote-{datetime.now(IST).date()}")
    o.ok("materials policy", "POST", "/materials/policy", {"version_id": sid("cm-policy"), "policy": policy}, want=(200, 201, 409))
    o.ok("item", "PUT", f"/materials/items/{item}", {"name": "Smoke test paver block 80 mm (synthetic)", "sell_unit": "sq_ft", "area_unit": "sq_ft", "stock_status": "in_stock", "active": False, "price_paise": 6500})
    o.ok("item figures", "PUT", f"/catalogue/{item}/custom", {"values": {"product_type": "paver_block", "thickness_mm": "80", "size": "200 x 100 mm", "pieces_per_area": 4.5, "pieces_per_pallet": 500,
                                                                         "minimum_order": 100, "lead_days": 3, "hsn_code": "68101990", "gst_rate_percent": 18}})
    lead = first_lead(o)
    o.ok("enquiry", "POST", f"/leads/{lead}/enquiries", {"id": enquiry, "channel": "email", "received_at": "2026-10-13T10:00:00+00:00",
                                                        "text": "Smoke test: need about 1,000 sq ft of 80 mm paver blocks for a driveway at Kukatpally Hyderabad (synthetic)."}, want=(200, 201, 409))
    for line, field, value in ((1, "product_type", "paver blocks"), (1, "area", "1,000 sq ft"), (1, "thickness", "80 mm"), (None, "application", "driveway"), (None, "site_location", "Kukatpally Hyderabad")):
        body: dict[str, Any] = {"field": field, "value": value}
        if line is not None:
            body["line"] = line
        o.ok(f"requirement field {field}", "POST", f"/enquiries/{enquiry}/requirement-fields", body, want=(200, 201, 409))
    view = o.ok("requirement", "GET", f"/enquiries/{enquiry}/requirement")
    for f in view["fields"]:
        if f["state"] == "proposed":
            o.ok("confirm field", "POST", f"/requirement-fields/{f['id']}/decision", {"decision": "confirm"})
    req = str(view["requirement"]["id"])
    o.ok("confirm requirement", "POST", f"/requirements/{req}/confirm", want=(200, 201, 409))
    picks = [{"line_no": 1, "item_id": item}]
    o.ok("preview", "POST", f"/materials/requirements/{req}/preview", {"picks": picks})
    o.ok("draft", "POST", f"/materials/requirements/{req}/quotes", {"quote_id": req_quote, "picks": picks})
    done = o.ok("approve materials quote", "POST", f"/materials/quotes/{req_quote}/approve", want=(200, 201, 409))
    if isinstance(done, dict) and done.get("error", {}).get("code") == "quote_not_draft":  # a second run on the same day: this quote is already approved
        record("construction_materials: one materials quote previewed, drafted and approved (second factor)", "PASS", "already approved earlier today (replay)")
        return
    record("construction_materials: one materials quote previewed, drafted and approved (second factor)", "PASS", f"status={done.get('status')}, total_paise={done.get('total_paise')}")


def ensure_template(o: Owner) -> str:
    """The operator's act, as in tests/integration/test_cp_campaigns.py: what WhatsApp's owner decided about a template. Here a SYNTHETIC row marked approved; no provider exists (the only channel is the fake one)."""
    template, tenant = sid(f"{o.pack}-smoke-template"), o.t.rsplit("/", 1)[1]
    ss.run(["supabase", "db", "query", "--linked", "--agent", "no",
            "insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) "
            f"values ('{template}', '{tenant}', 'smoke_test_reminder', 'en', 'utility', 'reminder', 'Smoke test (synthetic) reminder: {{{{1}}}} Thank you.', 'approved') on conflict (id) do nothing"])
    return template


def campaign(o: Owner, kind: str) -> None:
    contact, camp = sid(f"{o.pack}-smoke-contact"), sid(f"{o.pack}-smoke-campaign")
    template = ensure_template(o)
    o.ok("contact", "POST", "/contacts", {"id": contact, "full_name": "Smoke test person (synthetic)", "phone": "+00 000 000 9001"}, want=(200, 201, 409))
    due = (datetime.now(IST).date() + timedelta(days=5)).isoformat()
    o.ok("campaign", "PUT", f"/campaigns/{camp}", {"name": "Smoke test reminder (synthetic)", "kind": kind, "language": "en", "wa_template_id": template,
                                                   "message_text": "Dear {{name}}, {{amount}} is pending, due on {{due_date}}. Thank you, {{business}}.", "steps": [{"offset_days": 0, "time": "10:00"}]})
    o.ok("recipients", "POST", f"/campaigns/{camp}/recipients", {"rows": [{"contact_id": contact, "due_date": due, "amount_paise": 150000, "reference": "SMOKE-1"}]})
    preview = o.ok("preview", "GET", f"/campaigns/{camp}/preview")
    note = f"recipients={preview['recipients']}, issues={preview['issues']}, sending_on={preview['sending_on']}"
    if preview["issues"]:
        record(f"{o.pack}: campaign preview", "WARN", note)
    approved = o.ok("approve campaign", "POST", f"/campaigns/{camp}/approve", {"samples_sha256": preview["samples_sha256"]}, want=(200, 409))
    if approved.get("campaign"):
        record(f"{o.pack}: one {kind} campaign previewed and approved (second factor, fake sending)", "PASS", f"status={approved['campaign']['status']}, planned_steps={approved['planned_steps']}, sending_on={approved['sending_on']}")
    elif approved.get("error", {}).get("code") == "campaign_state":
        record(f"{o.pack}: campaign approval", "PASS", "already approved on an earlier run (replay)")
    else:
        record(f"{o.pack}: campaign approval", "FAIL", str(approved.get("error", {}).get("code")))


def step(name: str, fn: Any, *args: Any) -> None:
    try:
        fn(*args)
    except ss.SeedError as e:
        record(name, "FAIL", str(e))
    except Exception as e:  # noqa: BLE001 - a smoke test reports, it does not crash
        record(name, "FAIL", f"{type(e).__name__}: {str(e)[:150]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    args = ap.parse_args()
    try:
        ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=args.i_know_this_is_staging, project_ref=args.project_ref))
        s = ss.Seeder(args.api_url)
        owners = {pack: Owner(s, pack) for pack, _, _ in ss.BUSINESSES}
    except ss.SeedError as e:
        print(f"staging-smoke: {e}", file=sys.stderr)
        return 2
    step("textiles: quote", textiles_quote, owners["textiles"])
    step("construction_materials: quote", construction_quote, owners["construction_materials"])
    mods = owners["education"].ok("modules", "GET", "/modules")
    on = {m["module"] for m in mods.get("modules", []) if m.get("enabled")} if isinstance(mods, dict) else set()
    record("education: quote module", "INFO", "on" if "quotes" in on else "not part of this pack (no quote to make); modules on: " + ", ".join(sorted(on))[:200])
    step("construction_materials: campaign", campaign, owners["construction_materials"], "payment_due")
    step("education: campaign", campaign, owners["education"], "fee_due")
    fails = [r for r in RESULTS if r[1] == "FAIL"]
    print(f"\nstaging-smoke (API): {len([r for r in RESULTS if r[1] == 'PASS'])} passed, {len(fails)} failed")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
