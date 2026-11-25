"""A burst of concurrent signed-in requests against ONE route of a staging-backed API, with latency percentiles and an error count (no secrets printed).

  python3 scripts/load_burst.py --i-know-this-is-staging --api-url http://localhost:8000 --path /v1/signup/status --concurrency 100 --rounds 3 [--pack textiles]

This measures the API and its database path under many simultaneous requests (the plan's "100 at once" for the sign-up pages); it is not a sign-up through Supabase Auth (those are limited by Auth's own settings,
see reports/signup-opening-design.md section 4) and it places no call. For many simulated shops use `make loadtest`; the API's limit on live calls is checked in tests/test_call_coordination.py.
A 503 here is usually the API's own back-pressure, not a crash: PAGE_MAX_INFLIGHT (12 on staging and production) requests run at once, PAGE_QUEUE_MAX (60) wait up to PAGE_QUEUE_WAIT_S (1 s), the rest are refused at once. Measured 25 Nov 2026 on a laptop against staging data: 100 simultaneous requests to one instance = about half answered 200 (p50 about 0.7 s), about half 503.
One token is used for every request, so per-person limits (for example 5 phone codes an hour) answer 429: those are counted as `limited`, not as errors."""

from __future__ import annotations

import argparse
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402


def one(url: str, token: str, out: list[tuple[int, float]]) -> None:
    began = time.perf_counter()
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
            r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:  # noqa: BLE001 - a network failure is an error of this run
        code = 0
    out.append((code, (time.perf_counter() - began) * 1000))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--api-url", default="http://localhost:8000")
    p.add_argument("--path", default="/v1/signup/status")
    p.add_argument("--concurrency", type=int, default=100)
    p.add_argument("--rounds", type=int, default=3)
    p.add_argument("--pack", default="textiles")
    p.add_argument("--i-know-this-is-staging", action="store_true")
    a = p.parse_args()
    if not a.i_know_this_is_staging:
        print("refusing: pass --i-know-this-is-staging")
        return 2
    s = ss.Seeder("https://placeholder.invalid")
    s.api = a.api_url.rstrip("/")
    token = s.second_factor(a.pack, s.sign_in(f"demo-{a.pack.replace('_', '-')}@{ss.DEMO_DOMAIN}", ss.secret_get(f"sme-demo-{a.pack}-password") or ""))
    path = a.path.replace("{tenant}", str(s.call(token, "GET", "/v1/account/setup")[1]["tenant_id"]))
    results: list[tuple[int, float]] = []
    for n in range(a.rounds):
        threads = [threading.Thread(target=one, args=(s.api + path, token, results)) for _ in range(a.concurrency)]
        wall = time.perf_counter()
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        print(f"round {n + 1}: {a.concurrency} requests in {time.perf_counter() - wall:.1f} s")
    times = sorted(ms for _, ms in results)
    ok = sum(1 for c, _ in results if 200 <= c < 300)
    limited = sum(1 for c, _ in results if c == 429)
    errors = sum(1 for c, _ in results if c == 0 or c >= 500)
    q = lambda f: times[min(len(times) - 1, int(f * len(times)))]  # noqa: E731
    print(f"{len(results)} requests: {ok} ok, {limited} limited (429), {errors} errors; latency p50 {statistics.median(times):.0f} ms, p95 {q(0.95):.0f} ms, max {times[-1]:.0f} ms")
    from collections import Counter

    print("status codes:", dict(sorted(Counter(c for c, _ in results).items())))
    print("PASS" if errors == 0 else "FAIL")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
