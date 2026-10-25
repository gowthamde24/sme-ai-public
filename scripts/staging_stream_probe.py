"""When does each event of an Ask answer arrive? (job DG) Signs in as the textiles demo owner on STAGING and asks one long question twice: directly at the API, and through the web and the Cloudflare Worker (what a browser
does). Prints, per path, the seconds from the request to the first byte and to each event (step, text, source, done), so a hop that holds a stream back shows as a burst. Costs about one rupee-tenth per question.
Run: python3 scripts/staging_stream_probe.py --i-know-this-is-staging --project-ref uiallwgywitryxatcqxf --api-url https://sme-api-... --web-url https://staging.stack19.com"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import staging_smoke_api as sm  # noqa: E402

import seed_staging as ss  # noqa: E402  # isort: skip

QUESTION = "Go through my recent quotes and enquiries and, in one full sentence each, tell me where each one stands and what I should do next."


TEXT: list[str] = []  # the answer text of the last run, to read it (synthetic workspaces only)


def timed(url: str, token: str, body: dict, headers: dict[str, str] | None = None) -> list[tuple[float, str]]:
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", **(headers or {})})  # noqa: S310 - https only
    t0 = time.time()
    seen: list[tuple[float, str]] = []
    with urllib.request.urlopen(req, timeout=180) as r:  # noqa: S310
        seen.append((time.time() - t0, f"headers (HTTP {r.status}, {r.headers.get('content-type')})"))
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            if line.startswith("data:"):
                line = line[5:].strip()
            if line.startswith("event:"):
                continue
            try:
                ev = json.loads(line)
                if ev.get("type") == "text":
                    TEXT.append(str(ev.get("delta", "")))
                label = ev.get("type", "?") + (f" ({len(ev.get('delta', ''))} chars)" if ev.get("type") == "text" else "")
                if ev.get("type") == "error":
                    label += f" code={ev.get('code')}"
            except ValueError:
                label = f"line ({len(line)} bytes)"
            seen.append((time.time() - t0, label))
    return seen


def answer_chars(seen: list[tuple[float, str]]) -> int:
    return sum(int(w.split("(")[1].split(" ")[0]) for _, w in seen if w.startswith("text"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--web-url", required=True)
    ap.add_argument("--question", default=QUESTION)
    ap.add_argument("--pack", default="construction_materials", choices=["textiles", "construction_materials", "education"])
    args = ap.parse_args()
    ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=args.i_know_this_is_staging, project_ref=args.project_ref))
    s = ss.Seeder(args.api_url)
    owner = sm.Owner(s, args.pack)
    tenant = owner.t.rsplit("/", 1)[1]
    print("A. directly at the API:")
    ev = timed(f"{args.api_url}{owner.t}/assistant/messages", owner.token, {"message_id": str(uuid.uuid4()), "text": args.question})
    for at, what in ev:
        print(f"   {at:6.2f} s  {what}")
    print("   answer: " + "".join(TEXT).strip())
    print(f"   -> {answer_chars(ev)} characters of answer; {len(ev)} events, first text at {next((a for a, w in ev if w.startswith('text')), float('nan')):.2f} s, done at {ev[-1][0]:.2f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
