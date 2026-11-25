"""PAGE CAPACITY LOAD against the STAGING API (26 Nov 2026): how many page reads at once before `503 busy`, and how the latency grows. Read-only GETs of one synthetic workspace; no call is made.

  python3 -I scripts/capacity_load.py --i-know-this-is-staging --api-url https://<staging api> [--levels 5,10,20,40,80] [--seconds 15] [--label baseline]

Signs in as a synthetic demo owner (the password lives in Secret Manager, read in memory), opens the SAME mix of reads a Today page makes (about 8 different GETs) with N workers at once for `--seconds`, and prints per level:
requests, requests a second, status counts (200 / 503 busy / 429 / other), and p50 / p95 / p99 latency in milliseconds. Nothing is written."""

# ruff: noqa: E501

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

PATHS = ["/v1/me", "/v1/tenants/{t}", "/v1/tenants/{t}/billing/balance", "/v1/tenants/{t}/billing/credits/statement?limit=20", "/v1/tenants/{t}/leads?limit=20", "/v1/tenants/{t}/calls?limit=20", "/v1/tenants/{t}/today/summary", "/v1/tenants/{t}/outbox/settings"]


def one(url: str, token: str) -> tuple[int, float]:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310
            r.read()
            return r.status, (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as exc:
        exc.read()
        return exc.code, (time.perf_counter() - t0) * 1000
    except Exception:  # noqa: BLE001
        return 0, (time.perf_counter() - t0) * 1000


def level(api: str, who: list[tuple[str, str]], workers: int, seconds: float) -> dict[str, object]:
    stop = time.monotonic() + seconds
    results: list[tuple[int, float]] = []
    lock = threading.Lock()

    def work(i: int) -> None:
        n = i
        while time.monotonic() < stop:
            token, tenant = who[i % len(who)]
            st, ms = one(api + PATHS[n % len(PATHS)].format(t=tenant), token)
            with lock:
                results.append((st, ms))
            n += 1

    threads = [threading.Thread(target=work, args=(i,)) for i in range(workers)]
    t0 = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    took = time.monotonic() - t0
    lat = sorted(ms for st, ms in results if st == 200)
    counts: dict[int, int] = {}
    for st, _ in results:
        counts[st] = counts.get(st, 0) + 1

    def pct(p: float) -> float:
        return round(lat[min(len(lat) - 1, int(len(lat) * p))], 0) if lat else 0.0

    return {"workers": workers, "requests": len(results), "rps": round(len(results) / took, 1), "ok": counts.get(200, 0), "busy_503": counts.get(503, 0), "rate_429": counts.get(429, 0), "other": sum(v for k, v in counts.items() if k not in (200, 503, 429)), "p50": pct(0.5), "p95": pct(0.95), "p99": pct(0.99), "mean": round(statistics.fmean(lat), 0) if lat else 0.0}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--levels", default="5,10,20,40,80")
    ap.add_argument("--seconds", type=float, default=15)
    ap.add_argument("--label", default="run")
    ap.add_argument("--packs", default="textiles,construction_materials,education")
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    a = ap.parse_args()
    if not a.i_know_this_is_staging:
        print("refusing: pass --i-know-this-is-staging")
        return 2
    s = ss.Seeder(a.api_url)
    who: list[tuple[str, str]] = []
    for pack in a.packs.split(","):   # one token per synthetic demo owner: the API limits each token (1200 a minute), so several are needed to find the server's own limit
        pw = ss.secret_get(f"sme-demo-{pack}-password")
        if pw is None:
            raise ss.SeedError(f"no demo password for {pack}")
        token = s.sign_in(f"demo-{pack.replace('_', '-')}@{ss.DEMO_DOMAIN}", pw)["access_token"]
        me = s.call(token, "GET", "/v1/me")[1]
        mem = me.get("memberships") or [] if isinstance(me, dict) else []
        if mem and isinstance(mem[0], dict):
            who.append((token, str((mem[0].get("tenant") or {}).get("id") or "")))
    if not who:
        raise ss.SeedError("no demo owner could sign in")
    one(a.api_url + "/ready", who[0][0])
    print(f"{len(who)} synthetic owners (tokens)")
    print(f"label={a.label} api={a.api_url} reads={len(PATHS)} per rotation, {a.seconds:.0f} s a level")
    print("workers requests   rps    ok  busy503  rate429 other   p50   p95   p99")
    for w in [int(x) for x in a.levels.split(",")]:
        r = level(a.api_url, who, w, a.seconds)
        print(f"{r['workers']:>7} {r['requests']:>8} {r['rps']:>6} {r['ok']:>5} {r['busy_503']:>8} {r['rate_429']:>8} {r['other']:>5} {r['p50']:>5.0f} {r['p95']:>5.0f} {r['p99']:>5.0f}")
        time.sleep(3)
    return 0


if __name__ == "__main__":
    sys.exit(main())
