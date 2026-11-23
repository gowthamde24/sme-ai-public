"""make staging-smoke-ai: the AI half of the staging smoke test (job DC). Asks the Main agent ONE short question in each of the three synthetic demo workspaces, through the DEPLOYED API with the
real Anthropic adapter, and reports what it cost (agent_runs, the app's own ledger). It spends real money, a few paise: the caps are the workspace's daily cap (Rs 2), the run's cap (Rs 1)
and the key's own limit at the provider. Same guards and sign-in as staging_smoke_api.py. Nothing is sent, approved or priced by the assistant.

Run: python3 scripts/staging_smoke_ai.py --i-know-this-is-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api>
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402
import staging_smoke_api as sm  # noqa: E402

QUESTION = "What needs me today? Answer in two short sentences."


def ask(o: sm.Owner, api: str) -> dict:
    body = json.dumps({"message_id": str(uuid.uuid4()), "text": QUESTION}).encode()
    req = urllib.request.Request(f"{api}{o.t}/assistant/messages", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {o.token}", "Content-Type": "application/json", "Accept": "text/event-stream"})  # noqa: S310 - https only
    events: list[dict] = []
    try:
        with urllib.request.urlopen(req, timeout=120) as r:  # noqa: S310
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if line.startswith("data:"):
                    events.append(json.loads(line[5:]))
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read()).get("error", {})
        except ValueError:
            err = {}
        return {"http": e.code, "code": err.get("code"), "answer": ""}
    text = "".join(ev.get("delta", "") for ev in events if ev.get("type") == "text")
    errors = [ev for ev in events if ev.get("type") == "error"]
    return {"http": 200, "answer": text, "sources": sum(1 for ev in events if ev.get("type") == "source"), "error": errors[0].get("code") if errors else None,
            "done": any(ev.get("type") == "done" for ev in events)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    args = ap.parse_args()
    try:
        ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=args.i_know_this_is_staging, project_ref=args.project_ref))
        s = ss.Seeder(args.api_url)
        owners = [sm.Owner(s, pack) for pack, _, _ in ss.BUSINESSES]
    except ss.SeedError as e:
        print(f"staging-smoke-ai: {e}", file=sys.stderr)
        return 2
    failed = 0
    for o in owners:
        r = ask(o, args.api_url.rstrip("/"))
        ok = r["http"] == 200 and r.get("done") and not r.get("error") and len(r["answer"]) > 20
        failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {o.pack}: assistant answered :: http={r['http']} error={r.get('error') or r.get('code')} answer_chars={len(r['answer'])} sources={r.get('sources')}")
    sql = ("select t.slug, count(*)::int as runs, coalesce(sum(r.input_tokens_used),0)::int as tokens_in, coalesce(sum(r.output_tokens_used),0)::int as tokens_out, "
           "coalesce(sum(r.cost_micros_used),0)::bigint as micros from public.agent_runs r join public.tenants t on t.id = r.tenant_id "
           "where r.agent_name = 'assistant' group by 1 order by 1")
    rows = ss.json_from(ss.run(["supabase", "db", "query", "--linked", "--agent", "no", "-o", "json", sql]))
    total = sum(int(r["micros"]) for r in rows)
    for r in rows:
        print(f"spend  {r['slug']}: {r['runs']} run(s), {r['tokens_in']} tokens in, {r['tokens_out']} tokens out, Rs {int(r['micros']) / 1_000_000:.4f}")
    print(f"AI spend recorded in the app's ledger (all assistant runs so far): Rs {total / 1_000_000:.4f} (1,000,000 micros = Rs 1)")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
