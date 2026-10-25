"""The usage-test harness (job DI, ADR 0092): what the staging workspaces actually used, and what a plan would cost US at low, typical and heavy use. The owner sets prices from this table.

  python3 -I scripts/usage_report.py --source staging --i-know-this-reads-staging --project-ref uiallwgywitryxatcqxf [--days 14] [--out report.md]
  python3 -I scripts/usage_report.py --source fixture tests/fixtures/usage_rows.json        (no network: the unit test's data)

READ-ONLY. It asks the hosted staging database (synthetic data only; the Management API of `supabase login`, in memory) four SELECTs and writes nothing anywhere but the markdown file it is told to:
  * the AI ledger per workspace per day (agent_cost_reservations: rupees and calls),
  * the business-initiated WhatsApp messages that were SENT per workspace per day (outbox_messages, replies inside the 24-hour window excluded),
  * the call minutes per workspace per day (billing_usage_events, once the billing migration is deployed; before that there are none and the report says so),
  * the plans' internal AI allowances (plan_ai_allowances: the worst case the AI fair use can cost per plan).
Workspaces are shown by a short hash, never by name. The cost model is scripts/usage_assumptions.json: every figure there that is not measured is an ASSUMPTION and is printed beside the answer."""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
STAGING_REF = "uiallwgywitryxatcqxf"
LEVELS = ("low", "typical", "heavy")

QUERIES = {
    "ai": "select tenant_id::text as tenant, cost_day::text as day, count(*)::int as calls, (coalesce(sum(coalesce(settled_micros, reserved_micros)), 0) / 1000000.0)::float8 as rupees "
    "from public.agent_cost_reservations where cost_day >= current_date - {days} group by 1, 2 order by 2, 1",
    "messages": "select tenant_id::text as tenant, (sent_at at time zone 'Asia/Kolkata')::date::text as day, count(*)::int as messages "
    "from public.outbox_messages where status = 'sent' and category <> 'reply_to_inbound' and sent_at >= now() - interval '{days} days' group by 1, 2 order by 2, 1",
    "minutes": "select tenant_id::text as tenant, (at at time zone 'Asia/Kolkata')::date::text as day, (sum(units) / 60.0)::float8 as minutes "
    "from public.billing_usage_events where kind = 'call_minutes' and at >= now() - interval '{days} days' group by 1, 2 order by 2, 1",
    "allowances": "select plan, daily_paise, monthly_paise from public.plan_ai_allowances order by plan",
    "have_minutes": "select to_regclass('public.billing_usage_events') is not null as present",
}
PLAN_ORDER = ("free_trial", "starter", "growth", "business", "calls_payg", "calls_300", "calls_1000")


def short(tenant: str) -> str:
    return "ws-" + hashlib.sha256(tenant.encode()).hexdigest()[:6]


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(p * (len(ordered) - 1))))]


def measured_ai(ai_rows: list[dict[str, Any]], assumptions: dict[str, Any]) -> dict[str, Any]:
    """Rupees per ACTIVE workspace-day: low = 25th percentile, typical = median, heavy = 90th. Falls back to the assumed figures when there are too few active days to mean anything."""
    active = [float(r["rupees"]) for r in ai_rows if float(r["rupees"]) > 0]
    fb = assumptions["ai_rupees_per_active_day_fallback"]
    if len(active) < 5:
        return {"low": fb["low"], "typical": fb["typical"], "heavy": fb["heavy"], "basis": f"FALLBACK ({len(active)} active workspace-days measured, fewer than 5)", "active_days": len(active)}
    return {
        "low": round(percentile(active, 0.25), 3),
        "typical": round(statistics.median(active), 3),
        "heavy": round(percentile(active, 0.90), 3),
        "basis": f"measured on staging ({len(active)} active workspace-days; synthetic traffic from the test harnesses, so read it as a floor)",
        "active_days": len(active),
    }


def call_rupees_per_minute(assumptions: dict[str, Any]) -> float:
    return round(sum(float(v["value"]) for v in assumptions["call_rupees_per_minute"].values()), 4)


def plan_costs(catalogue: dict[str, Any], allowances: list[dict[str, Any]], ai: dict[str, Any], assumptions: dict[str, Any]) -> list[dict[str, Any]]:
    """Our monthly cost to serve one workspace on each plan at each use level."""
    days = assumptions["days_per_period"]
    per_msg = float(assumptions["whatsapp_rupees_per_business_message"]["value"])
    per_min = call_rupees_per_minute(assumptions)
    monthly_ai_ceiling = {a["plan"]: a["monthly_paise"] / 100 for a in allowances}
    margin, fee = assumptions["target_gross_margin_percent"] / 100, assumptions["payment_fee_percent"] / 100
    out: list[dict[str, Any]] = []
    plans = {p["id"]: p for p in catalogue["plans"]}
    for pid in PLAN_ORDER:
        plan = plans.get(pid)
        if plan is None:
            continue
        row: dict[str, Any] = {"id": pid, "minutes": plan["allowances"]["call_minutes"], "messages": plan["allowances"]["whatsapp_messages"], "ai_ceiling": monthly_ai_ceiling.get(pid), "levels": {}}
        for level in LEVELS:
            share = assumptions["use_levels"][level]
            minutes = assumptions["pay_as_you_go_minutes"][level] if plan["allowances"]["call_minutes"] is None else plan["allowances"]["call_minutes"] * share
            messages = plan["allowances"]["whatsapp_messages"] * share
            ai_cost = ai[level] * assumptions["ai_active_days"][level] * days
            if row["ai_ceiling"] is not None:
                ai_cost = min(ai_cost, row["ai_ceiling"])   # the fair use cannot cost more than the plan's monthly AI allowance
            calls_cost, msg_cost = minutes * per_min, messages * per_msg
            total = ai_cost + calls_cost + msg_cost
            row["levels"][level] = {"minutes": round(minutes, 1), "messages": round(messages), "ai": round(ai_cost, 2), "calls": round(calls_cost, 2), "wa": round(msg_cost, 2), "total": round(total, 2), "price_for_margin": round(total / (1 - margin - fee), 2)}
        out.append(row)
    return out


def table(rows: list[list[Any]], head: list[str]) -> str:
    lines = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def build_report(data: dict[str, Any], catalogue: dict[str, Any], assumptions: dict[str, Any], *, days: int, source: str) -> str:
    ai = measured_ai(data["ai"], assumptions)
    costs = plan_costs(catalogue, data["allowances"], ai, assumptions)
    per_min = call_rupees_per_minute(assumptions)
    per_msg = assumptions["whatsapp_rupees_per_business_message"]["value"]
    out = [f"# Usage report ({source}, last {days} days)", ""]
    out.append("Synthetic workspaces only. Workspaces are shown by a short hash. Read-only. **Every rupee figure marked ASSUMPTION is a placeholder; prices must not be set from this table until the owner has replaced them with the real rate cards.**")
    out += ["", "## Measured per workspace per day", ""]
    days_seen: dict[tuple[str, str], dict[str, Any]] = {}
    for r in data["ai"]:
        days_seen.setdefault((r["day"], short(r["tenant"])), {})["ai"] = (r["calls"], r["rupees"])
    for r in data["messages"]:
        days_seen.setdefault((r["day"], short(r["tenant"])), {})["msg"] = r["messages"]
    for r in data["minutes"]:
        days_seen.setdefault((r["day"], short(r["tenant"])), {})["min"] = r["minutes"]
    if days_seen:
        rows = []
        for (day, ws), v in sorted(days_seen.items()):
            calls, rupees = v.get("ai", (0, 0.0))
            rows.append([day, ws, calls, f"{rupees:.2f}", v.get("msg", 0), f"{v.get('min', 0.0):.1f}"])
        out.append(table(rows, ["day", "workspace", "AI calls", "AI cost (Rs)", "business WhatsApp messages sent", "call minutes"]))
    else:
        out.append("_Nothing was recorded in this window._")
    if not data["have_minutes"]:
        out += ["", "_Call minutes: the billing tables are not on this database yet (the billing migration is not deployed), and telephony is not built, so there are no call minutes to read. Call costs below come from the assumptions only._"]
    out += ["", "## What the AI costs us per active workspace-day", "", f"low Rs {ai['low']}, typical Rs {ai['typical']}, heavy Rs {ai['heavy']}: {ai['basis']}.", ""]
    out += ["## Assumptions used for everything that is not measured", ""]
    out.append(table(
        [["WhatsApp, one business-initiated message", f"Rs {per_msg}", assumptions["whatsapp_rupees_per_business_message"]["source"]]]
        + [[f"Call minute: {k.replace('_', ' ')}", f"Rs {v['value']}", v["source"]] for k, v in assumptions["call_rupees_per_minute"].items()]
        + [["Call minute, total", f"Rs {per_min}", "sum of the four lines above"], ["Use levels (share of the allowance used)", ", ".join(f"{k} {int(v * 100)}%" for k, v in assumptions["use_levels"].items()), "ASSUMPTION"],
           ["AI active days in a 30-day period", ", ".join(f"{k} {int(v * 100)}%" for k, v in assumptions["ai_active_days"].items()), "ASSUMPTION"],
           ["Target gross margin / payment fee", f"{assumptions['target_gross_margin_percent']}% / {assumptions['payment_fee_percent']}%", "ASSUMPTION (the payment fee is not verified)"],
           ["Pay-as-you-go minutes (low / typical / heavy)", " / ".join(str(assumptions["pay_as_you_go_minutes"][k]) for k in LEVELS), assumptions["pay_as_you_go_minutes"]["source"]]],
        ["item", "value", "source"]))
    out += ["", "## Our monthly cost to serve one workspace, per plan (rupees)", ""]
    rows = []
    for c in costs:
        lv = c["levels"]
        rows.append([c["id"], "no ceiling" if c["minutes"] is None else c["minutes"], c["messages"], f"Rs {c['ai_ceiling']:.0f}" if c["ai_ceiling"] is not None else "-",
                     " / ".join(f"{lv[k]['total']:.0f}" for k in LEVELS), " / ".join(f"{lv[k]['price_for_margin']:.0f}" for k in LEVELS)])
    out.append(table(rows, ["plan", "included minutes", "included messages", "AI fair-use ceiling a month", "cost low / typical / heavy", f"price for the target margin, low / typical / heavy"]))
    out += ["", "### Where each total comes from (typical use)", ""]
    rows = []
    for c in costs:
        t = c["levels"]["typical"]
        rows.append([c["id"], t["minutes"], f"{t['calls']:.0f}", t["messages"], f"{t['wa']:.0f}", f"{t['ai']:.0f}", f"{t['total']:.0f}"])
    out.append(table(rows, ["plan", "minutes used", "calls Rs", "messages sent", "WhatsApp Rs", "AI Rs", "total Rs"]))
    out += ["", "The AI line is capped at each plan's monthly fair-use allowance (the internal numbers of `plan_ai_allowances`, never shown to owners). Prices in `packages/plans/plans.json` stay `null` until the owner decides."]
    return "\n".join(out) + "\n"


def run_staging(project_ref: str, days: int) -> dict[str, Any]:
    import seed_staging as ss
    import sb_mgmt

    ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=True, project_ref=project_ref))

    def sql(name: str) -> list[dict[str, Any]]:
        query = QUERIES[name].format(days=days)
        if not query.lstrip().lower().startswith("select"):
            raise ValueError("read-only: SELECT only")
        status, body = sb_mgmt.call("POST", f"/v1/projects/{project_ref}/database/query", {"query": query})
        if status not in (200, 201) or not isinstance(body, list):
            raise RuntimeError(f"{name}: HTTP {status}")
        return body

    have = bool(sql("have_minutes")[0]["present"])
    return {"ai": sql("ai"), "messages": sql("messages"), "minutes": sql("minutes") if have else [], "allowances": sql("allowances"), "have_minutes": have}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", choices=["staging", "fixture"], required=True)
    ap.add_argument("fixture", nargs="?")
    ap.add_argument("--i-know-this-reads-staging", action="store_true")
    ap.add_argument("--project-ref", default="")
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--out", default="")
    ap.add_argument("--assumptions", default=str(ROOT / "scripts" / "usage_assumptions.json"))
    args = ap.parse_args()
    assumptions = json.loads(Path(args.assumptions).read_text(encoding="utf-8"))
    catalogue = json.loads((ROOT / "packages" / "plans" / "plans.json").read_text(encoding="utf-8"))
    if args.source == "staging":
        if not args.i_know_this_reads_staging or args.project_ref != STAGING_REF:
            print("Refusing: pass --i-know-this-reads-staging and the staging --project-ref.", file=sys.stderr)
            return 2
        data = run_staging(args.project_ref, args.days)
    else:
        data = json.loads(Path(args.fixture or "").read_text(encoding="utf-8"))
    text = build_report(data, catalogue, assumptions, days=args.days, source=args.source)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
