// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

/**
 * The offline worker (public/sw.js, job BL) run in a small stand-in for a worker: a fake Cache Storage, fake requests. What matters is what it NEVER does: it never stores a page or an answer of the API,
 * never touches a login or a server call, and falls back to the offline page only when the network is gone.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "../../public/sw.js"), "utf8");
const ORIGIN = "https://shop.example";

type Handler = (event: unknown) => void;
class FakeCache {
  store = new Map<string, unknown>();
  async addAll(urls: string[]) {
    for (const u of urls) this.store.set(new URL(u, ORIGIN).pathname, `shell:${u}`);
  }
  async put(req: string | { url: string }, res: unknown) {
    this.store.set(new URL(typeof req === "string" ? req : req.url, ORIGIN).pathname, res);
  }
  async match(req: string | { url: string }) {
    return this.store.get(new URL(typeof req === "string" ? req : req.url, ORIGIN).pathname);
  }
  async keys() {
    return [...this.store.keys()].map((k) => ({ url: ORIGIN + k }));
  }
  async delete(req: { url: string }) {
    return this.store.delete(new URL(req.url).pathname);
  }
}

function boot(search = "") {
  const handlers: Record<string, Handler> = {};
  const caches = new Map<string, FakeCache>();
  const open = async (name: string) => caches.get(name) ?? caches.set(name, new FakeCache()).get(name)!;
  const fetched: string[] = [];
  const net = { up: true };
  class FakeResponse {
    constructor(
      public body: string,
      public ok = true,
      public type = "basic",
    ) {}
    clone() {
      return this;
    }
    async text() {
      return this.body;
    }
  }
  const self = {
    location: { href: `${ORIGIN}/sw.js${search}`, origin: ORIGIN },
    addEventListener: (t: string, h: Handler) => (handlers[t] = h),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const sandbox = {
    self,
    URL,
    Response: FakeResponse,
    caches: {
      open,
      keys: async () => [...caches.keys()],
      delete: async (n: string) => caches.delete(n),
      match: async (req: string | { url: string }, opts?: { cacheName?: string }) => {
        for (const [name, c] of caches) if (!opts?.cacheName || opts.cacheName === name) { const hit = await c.match(req); if (hit) return hit; }
        return undefined;
      },
    },
    fetch: async (req: { url: string }) => {
      fetched.push(new URL(req.url).pathname);
      if (!net.up) throw new TypeError("offline");
      return new FakeResponse(`network:${new URL(req.url).pathname}`);
    },
  };
  vm.runInNewContext(SOURCE, sandbox);
  const run = async (type: string, event: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  const request = (p: string, o: { method?: string; mode?: string; headers?: Record<string, string>; origin?: string } = {}) => ({
    url: `${o.origin ?? ORIGIN}${p}`,
    method: o.method ?? "GET",
    mode: o.mode ?? "no-cors",
    headers: { has: (h: string) => Object.keys(o.headers ?? {}).includes(h.toLowerCase()) },
  });
  /** returns undefined when the worker lets the browser handle it; else what it answered */
  const ask = async (req: ReturnType<typeof request>) => {
    let answer: Promise<unknown> | undefined;
    handlers.fetch({ request: req, respondWith: (p: Promise<unknown>) => (answer = p) });
    return answer ? await answer : undefined;
  };
  return { run, ask, request, caches, fetched, net };
}

describe("the offline worker", () => {
  it("on install keeps only the offline pages, their stylesheet and the circle", async () => {
    const w = boot();
    await w.run("install");
    expect([...w.caches.get("sme-shell-v1")!.store.keys()].sort()).toEqual(["/icons/orb.svg", "/offline/en.html", "/offline/hi.html", "/offline/kn.html", "/offline/offline.css", "/offline/te.html"]);
  });

  it("a page is fetched from the network and is never stored; with no network the offline page speaks the remembered language", async () => {
    const w = boot();
    await w.run("install");
    const page = await w.ask(w.request("/app/tenants/abc/orders", { mode: "navigate" }));
    expect(page).toMatchObject({ body: "network:/app/tenants/abc/orders" });
    expect([...w.caches.keys()].filter((n) => n !== "sme-shell-v1")).toEqual([]);
    await w.run("message", { data: { type: "lang", lang: "te" } });
    w.net.up = false;
    expect(await w.ask(w.request("/app", { mode: "navigate" }))).toBe("shell:/offline/te.html");
    await w.run("message", { data: { type: "lang", lang: "<script>" } }); // an unknown word is ignored
    expect(await w.ask(w.request("/app", { mode: "navigate" }))).toBe("shell:/offline/te.html");
  });

  it("speaks English when it was never told a language", async () => {
    const w = boot();
    await w.run("install");
    w.net.up = false;
    expect(await w.ask(w.request("/login", { mode: "navigate" }))).toBe("shell:/offline/en.html");
  });

  it("does not touch the API, a server call, a login, a POST, another site or a stream of server components", async () => {
    const w = boot();
    await w.run("install");
    for (const req of [
      w.request("/api/anything"),
      w.request("/app/tenants/abc/outbox?_rsc=1x"),
      w.request("/app/tenants/abc/outbox", { headers: { rsc: "1" } }),
      w.request("/app/tenants/abc", { headers: { "next-action": "abc" } }),
      w.request("/v1/tenants/abc/leads", { headers: { authorization: "Bearer x" } }),
      w.request("/app/tenants/abc/catalogue", { method: "POST" }),
      w.request("/storage/v1/object/sign/photo.jpg", { origin: "https://abc.supabase.co" }),
      w.request("/app/tenants/abc/outbox/export.csv"),
    ])
      expect(await w.ask(req), req.url).toBeUndefined();
    expect(w.fetched).toEqual([]); // it did not even go to the network itself: the browser does
  });

  it("keeps the application's own content-named files (and only those) in production", async () => {
    const w = boot();
    await w.run("install");
    const first = await w.ask(w.request("/_next/static/chunks/app-1a2b.js"));
    expect(first).toMatchObject({ body: "network:/_next/static/chunks/app-1a2b.js" });
    w.net.up = false;
    expect(await w.ask(w.request("/_next/static/chunks/app-1a2b.js"))).toMatchObject({ body: "network:/_next/static/chunks/app-1a2b.js" }); // from the cache
    expect([...w.caches.get("sme-static-v1")!.store.keys()]).toEqual(["/_next/static/chunks/app-1a2b.js"]);
    expect(await w.ask(w.request("/_next/data/xyz/app.json"))).toBeUndefined();
    expect(await w.ask(w.request("/icons/icon-192.png"))).toBeUndefined();
  });

  it("the development worker (?dev=1) keeps no code files at all", async () => {
    const w = boot("?dev=1");
    await w.run("install");
    expect(await w.ask(w.request("/_next/static/chunks/app.js"))).toBeUndefined();
    expect(w.caches.has("sme-static-v1")).toBe(false);
  });

  it("an update removes the old worker's caches", async () => {
    const w = boot();
    await w.run("install");
    w.caches.set("sme-shell-v0", new FakeCache());
    w.caches.set("customer-pages", new FakeCache());
    await w.run("activate");
    expect([...w.caches.keys()].sort()).toEqual(["sme-shell-v1"]);
  });

  it("its source never writes a page, an API answer or a request body into a cache", () => {
    const puts = SOURCE.match(/\.put\(/g) ?? [];
    expect(puts).toHaveLength(2); // the language word and the content-named file
    expect(SOURCE).not.toMatch(/indexedDB|localStorage|sessionStorage|importScripts|postMessage\(.*body/);
  });
});
