#!/usr/bin/env python3
# ruff: noqa: E501, S310, S603, S607, T201
"""The 12 Nov burst, replayed against STAGING through the API the way the web does it (docs/plans/db-timeouts-and-sizing.md, "The replay"). Read-only: it only GETs, as the demo owners.

  step 1  ONE signed-in owner opens Today every 5 s            (default 10 minutes)
  step 2  TEN such owners at once, each every 5 s               (default 5 minutes)
  step 3  THIRTY such owners at once, each every 5 s            (default 5 minutes)
A "Today page" is the summary request plus the reads the web makes next, up to 8 at a time. For every step it prints the page time and the summary request time (p50, p95, max), the status counts and the
failures sorted by kind: `timeout` (a 5xx whose answer says statement timeout or 57014), `busy` (the API's own limiter, 503), `other_5xx`, `client` (4xx), `network`. A step is stopped early when most of the
answers of the last 20 seconds are failures (the API limiter is protecting itself; the replay must not become a load test of the limiter).

Secrets are read from Secret Manager into memory and NEVER printed. Staging only: the addresses are fixed below.
Usage: python3 scripts/staging_burst_replay.py --i-know-this-loads-staging [--scale 1.0] [--steps 1,10,30] [--out FILE.json]"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import statistics
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

PROJECT = "project-2757c07e-37d2-4167-88f"
SUPA = "https://uiallwgywitryxatcqxf.supabase.co"


def publishable_key() -> str:
    """The Supabase publishable key of staging (public by design, but a secret scanner cannot tell, so it is never written in a file): the environment (deploy/staging.sh exports it), else the CLI."""
    import os

    got = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    if got:
        return got
    out = subprocess.run(["supabase", "projects", "api-keys", "--project-ref", "uiallwgywitryxatcqxf", "--agent", "no", "-o", "json"], capture_output=True, text=True, check=True).stdout
    return str(next(k["api_key"] for k in json.JSONDecoder().raw_decode(out)[0] if k["type"] == "publishable"))


KEY = publishable_key()
API = "https://sme-api-620338396268.asia-south1.run.app"
PACKS = ("education", "textiles", "coaching", "real_estate", "construction_materials")
CANDIDATES = ("/today/summary", "/nav-counts", "/notifications", "/live-calls", "/activity-log", "/billing/access", "/outbox/summary", "/agents/status", "/visits/today", "/tasks?limit=100", "/leads?limit=25",
              "/prospects/stats", "/ai-usage/week", "/outbox/settings", "/quotes?limit=50", "/outreach/batches", "/outreach/handoffs?open=true", "/outreach/rules", "/today")
PERIOD_S = 5.0
WEB_PARALLEL = 8


def secret(name: str) -> str:
    return subprocess.run(["gcloud", "secrets", "versions", "access", "latest", f"--secret={name}", f"--project={PROJECT}"], capture_output=True, text=True, check=True).stdout.strip()


def totp(b32: str) -> str:
    key = base64.b32decode(b32.strip().upper() + "=" * (-len(b32.strip()) % 8))
    h = hmac.new(key, struct.pack(">Q", int(time.time() // 30)), hashlib.sha1).digest()
    o = h[-1] & 15
    return str((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000).zfill(6)


def call(url: str, method: str = "GET", body: dict | None = None, token: str | None = None, key: bool = False, timeout: float = 30.0) -> tuple[int, bytes, float]:
    headers = {"content-type": "application/json", "accept": "application/json"}
    if key:
        headers["apikey"] = KEY
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    except (urllib.error.URLError, TimeoutError, OSError):
        raw, status = b"", 0
    return status, raw, (time.perf_counter() - t0) * 1000


def sign_in(pack: str) -> str:
    st, raw, _ = call(f"{SUPA}/auth/v1/token?grant_type=password", "POST", {"email": f"demo-{pack.replace('_', '-')}@demo.example.test", "password": secret(f"sme-demo-{pack}-password")}, key=True)
    assert st == 200, f"sign-in failed for {pack} ({st})"
    tok = json.loads(raw)
    access = tok["access_token"]
    factors = [f for f in (tok.get("user") or {}).get("factors", []) if f.get("factor_type") == "totp" and f.get("status") == "verified"]
    if not factors:
        return str(access)
    fid = factors[0]["id"]
    st, raw, _ = call(f"{SUPA}/auth/v1/factors/{fid}/challenge", "POST", {}, token=access, key=True)
    assert st == 200, f"challenge failed for {pack} ({st})"
    st, raw, _ = call(f"{SUPA}/auth/v1/factors/{fid}/verify", "POST", {"challenge_id": json.loads(raw)["id"], "code": totp(secret(f"sme-demo-{pack}-totp"))}, token=access, key=True)
    assert st == 200, f"second factor failed for {pack} ({st})"
    return str(json.loads(raw)["access_token"])


def classify(status: int, raw: bytes) -> str:
    if status == 200:
        return "ok"
    if status == 0:
        return "network"
    text = raw[:600].decode("utf-8", "replace").lower()
    if status >= 500 and ("57014" in text or "statement timeout" in text or "timeout" in text or "timed out" in text):
        return "timeout"
    if status == 503 and "busy" in text:
        return "busy"
    return "other_5xx" if status >= 500 else "client"


class Recorder:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.requests: list[tuple[float, str, str, float]] = []   # (finished_at, path, kind, ms)
        self.pages: list[float] = []

    def add(self, path: str, kind: str, ms: float) -> None:
        with self.lock:
            self.requests.append((time.monotonic(), path, kind, ms))

    def recent_failure_rate(self, seconds: float = 20.0) -> float:
        cut = time.monotonic() - seconds
        with self.lock:
            last = [k for t, _, k, _ in self.requests if t >= cut]
        return (sum(1 for k in last if k != "ok") / len(last)) if len(last) >= 20 else 0.0


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return float("nan")
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))]


def page(rec: Recorder, base: str, token: str, paths: list[str]) -> None:
    t0 = time.perf_counter()

    def one(path: str) -> None:
        st, raw, ms = call(base + path, token=token)
        rec.add(path, classify(st, raw), ms)

    with ThreadPoolExecutor(max_workers=WEB_PARALLEL) as ex:
        list(ex.map(one, paths))
    with rec.lock:
        rec.pages.append((time.perf_counter() - t0) * 1000)


def user_loop(rec: Recorder, base: str, token: str, paths: list[str], stop_at: float, stop: threading.Event, offset: float) -> None:
    time.sleep(offset)
    while time.monotonic() < stop_at and not stop.is_set():
        started = time.monotonic()
        page(rec, base, token, paths)
        time.sleep(max(0.0, PERIOD_S - (time.monotonic() - started)))


def run_step(name: str, users: int, seconds: float, sessions: list[tuple[str, str]], paths_for: dict[str, list[str]]) -> dict[str, object]:
    rec = Recorder()
    stop = threading.Event()
    stop_at = time.monotonic() + seconds
    threads = []
    for i in range(users):
        tenant, token = sessions[i % len(sessions)]
        t = threading.Thread(target=user_loop, args=(rec, f"{API}/v1/tenants/{tenant}", token, paths_for[tenant], stop_at, stop, (i * PERIOD_S) / max(users, 1)), daemon=True)
        t.start()
        threads.append(t)
    stopped_early = False
    while any(t.is_alive() for t in threads):
        time.sleep(2)
        if rec.recent_failure_rate() >= 0.6:
            stop.set()
            stopped_early = True
            break
    for t in threads:
        t.join(timeout=60)
    kinds: dict[str, int] = {}
    for _, _, k, _ in rec.requests:
        kinds[k] = kinds.get(k, 0) + 1
    summary_ms = [ms for _, p, k, ms in rec.requests if p == "/today/summary" and k == "ok"]
    ok_ms = [ms for _, _, k, ms in rec.requests if k == "ok"]
    return {
        "step": name, "users": users, "seconds": round(seconds), "stopped_early": stopped_early, "requests": len(rec.requests), "kinds": kinds,
        "page_ms": {"n": len(rec.pages), "p50": round(pct(rec.pages, 0.5)), "p95": round(pct(rec.pages, 0.95)), "max": round(max(rec.pages, default=float("nan")))},
        "summary_ms": {"n": len(summary_ms), "p50": round(pct(summary_ms, 0.5)), "p95": round(pct(summary_ms, 0.95)), "max": round(max(summary_ms, default=float("nan")))},
        "request_ms": {"p50": round(pct(ok_ms, 0.5)), "p95": round(pct(ok_ms, 0.95)), "max": round(max(ok_ms, default=float("nan")))},
        "timeouts": kinds.get("timeout", 0), "busy": kinds.get("busy", 0),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-know-this-loads-staging", action="store_true")
    ap.add_argument("--scale", type=float, default=1.0, help="multiply the step lengths (0.1 = a quick rehearsal)")
    ap.add_argument("--steps", default="1,10,30", help="which steps to run, by number of users")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    if not args.i_know_this_loads_staging:
        print("refusing: add --i-know-this-loads-staging (this sends a burst to the staging API)", file=sys.stderr)
        return 2
    lengths = {1: 600, 10: 300, 30: 300}
    sessions: list[tuple[str, str]] = []
    paths_for: dict[str, list[str]] = {}
    for pack in PACKS:
        token = sign_in(pack)
        st, raw, _ = call(f"{API}/v1/me", token=token)
        me = json.loads(raw)
        rows = me.get("tenants") or me.get("memberships") or []
        tenant = rows[0].get("tenant_id") or rows[0].get("id") or (rows[0].get("tenant") or {}).get("id")
        base = f"{API}/v1/tenants/{tenant}"
        ok = []
        for p in CANDIDATES:
            if call(base + p, token=token)[0] == 200:
                ok.append(p)
            time.sleep(0.3)
        paths_for[tenant] = ok
        sessions.append((tenant, token))
        print(f"{pack}: {len(ok)} reads in a Today page ({'summary' if '/today/summary' in ok else 'NO summary'})", flush=True)
    results = []
    for users in [int(x) for x in args.steps.split(",")]:
        seconds = lengths.get(users, 300) * args.scale
        print(f"--- step: {users} owner(s) every {PERIOD_S:.0f} s for {seconds:.0f} s", flush=True)
        r = run_step(f"{users}_users", users, seconds, sessions, paths_for)
        results.append(r)
        print(json.dumps(r), flush=True)
        time.sleep(20)   # a breath between steps
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"api": API, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "median_check": statistics.median([r["page_ms"]["p50"] for r in results if isinstance(r["page_ms"], dict)] or [0]), "steps": results}, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
