#!/usr/bin/env python3
"""Load test: N shops living a typical day at once, against the LOCAL stack (job CB, ADR 0082). `make loadtest SHOPS=50`.

What one shop does in the day (about 50 requests; the day is compressed into --duration seconds, each shop's requests spread over it with random gaps):
  4 x Today, 6 customers added (company + contact + lead = 18 writes), 8 enquiries recorded, 3 company edits, 12 reads of lists (companies, leads, quotes, orders, outbox summary, follow-ups due),
  and 5 questions to Agent OWL when --assistant is on (the scripted stand-in model: a real model would add its own latency and cost).
The shops are real accounts (signed up through the local auth, e-mail confirmed through the local database container, a workspace each). Everything is synthetic.

Safety: it refuses an API that is not on this machine, the owner's ports (8000, 54321), and any Supabase address that is not local. It sends nothing to anyone (no outbound message is made), spends nothing
(the stand-in model costs nothing) and writes only to the agent stack's database. Clean up with `make agent-db-reset`.

Results: a table per request class (count, errors, p50, p95, p99, max in ms), the throughput, the 429 count (a rate limit that fired is a finding), and a PASS/FAIL against --slo-p95-ms (default 1500) and
--slo-error-rate (default 0.01). Exit 1 on FAIL. --report FILE writes Markdown; --json FILE the raw numbers."""

from __future__ import annotations

import asyncio
import json
import os
import random
import re
import statistics
import sys
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from local_confirm import confirm_email  # noqa: E402

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
OWNER_PORTS = {8000, 54321}


@dataclass
class Sample:
    klass: str
    status: int
    ms: float


@dataclass
class Stats:
    samples: list[Sample] = field(default_factory=list)

    def add(self, klass: str, status: int, started: float) -> None:
        self.samples.append(Sample(klass, status, (time.perf_counter() - started) * 1000))


def refuse_unless_local(api: str, supabase: str) -> str | None:
    for name, url in (("API_URL", api), ("SUPABASE_URL", supabase)):
        parts = urlsplit(url)
        if parts.hostname not in LOCAL_HOSTS:
            return f"{name} is not on this machine: the load test runs only against the local stack"
        if parts.port in OWNER_PORTS:
            return f"{name} points at the OWNER's stack (port {parts.port}): use the agent stack (API 8001, Supabase 54421)"
    return None


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))]


def summarise(samples: list[Sample], seconds: float) -> dict[str, object]:
    by_class: dict[str, list[Sample]] = defaultdict(list)
    for s in samples:
        by_class[s.klass].append(s)
    rows = []
    for klass, items in sorted(by_class.items()):
        ms = [s.ms for s in items]
        errors = sum(1 for s in items if s.status >= 500 or s.status == 0)
        rows.append({"class": klass, "count": len(items), "errors": errors, "rate_limited": sum(1 for s in items if s.status == 429),
                     "client_errors": sum(1 for s in items if 400 <= s.status < 500 and s.status != 429), "p50": round(percentile(ms, 0.5), 1),
                     "p95": round(percentile(ms, 0.95), 1), "p99": round(percentile(ms, 0.99), 1), "max": round(max(ms), 1), "mean": round(statistics.fmean(ms), 1)})
    total = len(samples)
    errors = sum(1 for s in samples if s.status >= 500 or s.status == 0)
    all_ms = [s.ms for s in samples]
    return {"requests": total, "seconds": round(seconds, 1), "throughput_rps": round(total / seconds, 1) if seconds else 0, "errors": errors, "error_rate": round(errors / total, 4) if total else 0,
            "rate_limited": sum(1 for s in samples if s.status == 429), "client_errors": sum(1 for s in samples if 400 <= s.status < 500 and s.status != 429),
            "p50": round(percentile(all_ms, 0.5), 1), "p95": round(percentile(all_ms, 0.95), 1), "p99": round(percentile(all_ms, 0.99), 1), "classes": rows}


def verdict(summary: dict[str, object], slo_p95: float, slo_error_rate: float) -> list[str]:
    failures = []
    if float(summary["p95"]) > slo_p95:  # type: ignore[arg-type]
        failures.append(f"p95 {summary['p95']} ms is over {slo_p95:.0f} ms")
    if float(summary["error_rate"]) > slo_error_rate:  # type: ignore[arg-type]
        failures.append(f"error rate {summary['error_rate']} is over {slo_error_rate}")
    for row in summary["classes"]:  # type: ignore[attr-defined]
        if row["p95"] > slo_p95:
            failures.append(f"{row['class']}: p95 {row['p95']} ms is over {slo_p95:.0f} ms")
    return failures


def markdown(summary: dict[str, object], shops: int, failures: list[str], setup_seconds: float, args: dict[str, object]) -> str:
    lines = [
        f"# Load test: {shops} shops, one typical day each",
        "",
        f"{summary['requests']} requests in {summary['seconds']} s ({summary['throughput_rps']} per second); setup (accounts and workspaces) took {setup_seconds:.0f} s and is not counted. "
        f"Server errors {summary['errors']} (rate {summary['error_rate']}); client errors {summary['client_errors']}; rate limited (429) {summary['rate_limited']}. Whole run: p50 {summary['p50']} ms, p95 {summary['p95']} ms, p99 {summary['p99']} ms.",
        f"Settings: {json.dumps(args)}. Verdict: **{'FAIL: ' + '; '.join(failures) if failures else 'PASS'}**.",
        "",
        "| request class | count | 5xx/failed | 429 | 4xx | p50 ms | p95 ms | p99 ms | max ms |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in summary["classes"]:  # type: ignore[attr-defined]
        lines.append(f"| {r['class']} | {r['count']} | {r['errors']} | {r['rate_limited']} | {r['client_errors']} | {r['p50']} | {r['p95']} | {r['p99']} | {r['max']} |")
    return "\n".join(lines) + "\n"


class Shop:
    def __init__(self, n: int, api: str, supabase: str, key: str, stats: Stats, run: str) -> None:
        self.n, self.api, self.supabase, self.key, self.stats, self.run = n, api, supabase, key, stats, run
        self.email = f"loadtest-{run}-{n}@it.example.test"
        self.password = uuid.uuid4().hex + "Aa1!"
        self.token = ""
        self.tenant = ""
        self.slug = f"lt-{run}-{n}"
        self.leads: list[str] = []
        self.companies: list[str] = []
        self.rng = random.Random(f"{run}-{n}")  # noqa: S311

    @property
    def base(self) -> str:
        return f"{self.api}/v1/tenants/{self.tenant}"

    async def setup(self, http: httpx.AsyncClient) -> None:
        r = await http.post(f"{self.supabase}/auth/v1/signup", headers={"apikey": self.key}, json={"email": self.email, "password": self.password})
        r.raise_for_status()
        await asyncio.to_thread(confirm_email, self.email)
        r = await http.post(f"{self.supabase}/auth/v1/token?grant_type=password", headers={"apikey": self.key}, json={"email": self.email, "password": self.password})
        r.raise_for_status()
        self.token = r.json()["access_token"]
        made = await http.post(f"{self.api}/v1/tenants", json={"name": f"Load Test Silks {self.n}", "slug": self.slug}, headers=self.auth())
        made.raise_for_status()
        self.tenant = made.json()["id"]

    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    async def call(self, http: httpx.AsyncClient, klass: str, method: str, path: str, **kw: object) -> httpx.Response | None:
        started = time.perf_counter()
        try:
            r = await http.request(method, f"{self.base}{path}", headers=self.auth(), timeout=60, **kw)  # type: ignore[arg-type]
        except httpx.HTTPError:
            self.stats.add(klass, 0, started)
            return None
        self.stats.add(klass, r.status_code, started)
        return r

    async def add_customer(self, http: httpx.AsyncClient) -> None:
        cid, pid, lid = (str(uuid.uuid4()) for _ in range(3))
        n = self.rng.randrange(10**6)
        c = await self.call(http, "write: company", "POST", "/companies", json={"id": cid, "name": f"Customer {self.n}-{n}", "city": "Hyderabad", "type": "customer"})
        if c is None or c.status_code >= 300:
            return
        p = await self.call(http, "write: contact", "POST", "/contacts", json={"id": pid, "company_id": cid, "full_name": f"Person {n}", "email": f"p{n}-{self.n}@it.example.test", "phone": f"+00 9{self.n:03d} {n:06d}"})
        lead = await self.call(http, "write: lead", "POST", "/leads", json={"id": lid, "company_id": cid, "contact_id": pid if p is not None and p.status_code < 300 else None, "source": "load test"})
        if lead is not None and lead.status_code < 300:
            self.leads.append(lid)
            self.companies.append(cid)

    async def enquiry(self, http: httpx.AsyncClient) -> None:
        if not self.leads:
            return
        lead = self.rng.choice(self.leads)
        await self.call(http, "write: enquiry", "POST", f"/leads/{lead}/enquiries", json={"id": str(uuid.uuid4()), "channel": "other", "received_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() - 60)),
                                                                                         "subject": "Load test", "text": "We need 20 Kanchi pattu sarees for a wedding in March, deliver to Hyderabad."})

    async def ask(self, http: httpx.AsyncClient, text: str) -> None:
        await self.call(http, "assistant question", "POST", "/assistant/messages", json={"message_id": str(uuid.uuid4()), "text": text})

    async def day(self, http: httpx.AsyncClient, duration: float, assistant: bool, start_gate: asyncio.Event) -> None:
        await start_gate.wait()
        reads = [("read: today", "/today"), ("read: companies", "/companies?limit=20"), ("read: leads", "/leads?limit=20"), ("read: quotes", "/quotes"), ("read: orders", "/orders"),
                 ("read: outbox summary", "/outbox/summary"), ("read: follow-ups due", "/followups/due")]
        plan: list[tuple[float, str]] = []
        for _ in range(4):
            plan.append((self.rng.random(), "today"))
        for _ in range(6):
            plan.append((self.rng.random(), "customer"))
        for _ in range(8):
            plan.append((0.15 + 0.8 * self.rng.random(), "enquiry"))
        for _ in range(3):
            plan.append((0.2 + 0.7 * self.rng.random(), "edit"))
        for _ in range(12):
            plan.append((self.rng.random(), "read"))
        if assistant:
            for _ in range(5):
                plan.append((0.1 + 0.85 * self.rng.random(), "ask"))
        plan.sort()
        began = time.perf_counter()
        for at, what in plan:
            wait = at * duration - (time.perf_counter() - began)
            if wait > 0:
                await asyncio.sleep(wait)
            if what == "today":
                await self.call(http, "read: today", "GET", "/today")
            elif what == "customer":
                await self.add_customer(http)
            elif what == "enquiry":
                await self.enquiry(http)
            elif what == "edit" and self.companies:
                await self.call(http, "write: company edit", "PATCH", f"/companies/{self.rng.choice(self.companies)}", json={"industry": "Silk sarees"})
            elif what == "read":
                klass, path = self.rng.choice(reads)
                await self.call(http, klass, "GET", path)
            elif what == "ask":
                await self.ask(http, self.rng.choice(["What needs me today?", "Who hasn't paid?", "Show my quotes", "What is waiting for me?"]))


async def run(args: dict[str, object]) -> tuple[Stats, float, float]:
    shops_n, api, supabase, key = int(args["shops"]), str(args["api"]), str(args["supabase"]), str(args["key"])  # type: ignore[call-overload]
    run_id = uuid.uuid4().hex[:6]
    stats = Stats()
    limits = httpx.Limits(max_connections=200, max_keepalive_connections=100)
    async with httpx.AsyncClient(limits=limits, timeout=60) as http:
        shops = [Shop(n, api, supabase, key, Stats(), run_id) for n in range(shops_n)]
        for s in shops:
            s.stats = stats
        began = time.perf_counter()
        semaphore = asyncio.Semaphore(8)

        async def guarded(s: Shop) -> None:
            async with semaphore:
                await s.setup(http)

        await asyncio.gather(*(guarded(s) for s in shops))
        if args["assistant"]:
            slugs = ",".join(f"'{s.slug}'" for s in shops)
            await asyncio.to_thread(enable_assistant, slugs)
        setup_seconds = time.perf_counter() - began
        gate = asyncio.Event()
        tasks = [asyncio.create_task(s.day(http, float(args["duration"]), bool(args["assistant"]), gate)) for s in shops]  # type: ignore[arg-type]
        stats.samples.clear()
        started = time.perf_counter()
        gate.set()
        await asyncio.gather(*tasks)
        return stats, time.perf_counter() - started, setup_seconds


def enable_assistant(slugs: str) -> None:
    import subprocess

    from local_confirm import container

    if not re.fullmatch(r"('[a-z0-9-]+',?)+", slugs):  # our own generated slugs only
        raise ValueError("unexpected slug list")
    sql = f"select app.operator_enable_assistant(slug) from public.tenants where slug in ({slugs})"  # noqa: S608
    subprocess.run(["docker", "exec", "-i", container(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-At", "-c", sql], capture_output=True, text=True, check=True, timeout=120)  # noqa: S603, S607


def main(argv: list[str]) -> int:
    def opt(name: str, default: str) -> str:
        return argv[argv.index(name) + 1] if name in argv else default

    api = os.environ.get("API_URL", opt("--api", "http://localhost:8001")).rstrip("/")
    supabase = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY", "")
    if not supabase or not key:
        print("loadtest: SUPABASE_URL and the public key are not in the environment. Run it as `make loadtest` (it reads the local stack's public key).", file=sys.stderr)
        return 2
    problem = refuse_unless_local(api, supabase)
    if problem:
        print(f"loadtest: {problem}. Nothing was run.", file=sys.stderr)
        return 2
    shops = int(opt("--shops", os.environ.get("SHOPS", "50")))
    if not 1 <= shops <= 200:
        print("loadtest: --shops must be between 1 and 200. Nothing was run.", file=sys.stderr)
        return 2
    args: dict[str, object] = {"shops": shops, "duration": float(opt("--duration", "60")), "assistant": "--no-assistant" not in argv, "api": api, "supabase": supabase, "key": key}
    stats, seconds, setup_seconds = asyncio.run(run(args))
    summary = summarise(stats.samples, seconds)
    failures = verdict(summary, float(opt("--slo-p95-ms", "1500")), float(opt("--slo-error-rate", "0.01")))
    shown = {k: v for k, v in args.items() if k not in ("key", "supabase", "api")}
    text = markdown(summary, shops, failures, setup_seconds, shown)
    print(text)
    if "--report" in argv:
        Path(opt("--report", "")).expanduser().write_text(text, encoding="utf-8")
    if "--json" in argv:
        Path(opt("--json", "")).expanduser().write_text(json.dumps(summary, indent=1), encoding="utf-8")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
