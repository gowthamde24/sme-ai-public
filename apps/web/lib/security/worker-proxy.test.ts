import { afterEach, describe, expect, it, vi } from "vitest";

// a plain JavaScript file outside the app (deploy/), pasted into Cloudflare by hand in the rehearsal
import worker from "../../../../deploy/cloudflare-worker-proxy.js";

afterEach(() => vi.unstubAllGlobals());

/** Job CE: the optional Cloudflare Worker of the hosting rehearsal forwards a request as it is and says nothing more than the two forwarding headers. */
describe("the Cloudflare Worker that forwards to Cloud Run", () => {
  it("sends the same method, path, query and body to ORIGIN, adds the two forwarding headers, and does not follow redirects", async () => {
    const seen: Request[] = [];
    vi.stubGlobal("fetch", async (r: Request) => {
      seen.push(r);
      return new Response("", { status: 307, headers: { location: "https://sme-web-abc-el.a.run.app/login" } });
    });
    const answer = await worker.fetch(new Request("https://worker.example.workers.dev/app/tenants?x=1", { method: "POST", body: "hello", headers: { cookie: "sb-a=1", "x-custom": "yes" } }), { ORIGIN: "https://sme-web-abc-el.a.run.app" });
    const [sent] = seen;
    expect(sent.url).toBe("https://sme-web-abc-el.a.run.app/app/tenants?x=1");
    expect(sent.method).toBe("POST");
    expect(await sent.text()).toBe("hello");
    expect(sent.headers.get("x-forwarded-host")).toBe("worker.example.workers.dev");
    expect(sent.headers.get("x-forwarded-proto")).toBe("https");
    expect(sent.headers.get("cookie")).toBe("sb-a=1");
    expect(sent.redirect).toBe("manual");
    // the answer is passed back untouched: the test must show what the app does, not what the proxy hides
    expect(answer.status).toBe(307);
    expect(answer.headers.get("location")).toBe("https://sme-web-abc-el.a.run.app/login");
  });

  it("refuses an ORIGIN that is not https", async () => {
    const answer = await worker.fetch(new Request("https://w.example.workers.dev/"), { ORIGIN: "http://insecure.example.test" });
    expect(answer.status).toBe(500);
  });

  it("a forged X-Forwarded-Host from the browser is replaced, not passed on", async () => {
    const seen: Request[] = [];
    vi.stubGlobal("fetch", async (r: Request) => {
      seen.push(r);
      return new Response("ok");
    });
    await worker.fetch(new Request("https://w.example.workers.dev/", { headers: { "x-forwarded-host": "evil.example.test" } }), { ORIGIN: "https://sme-web-abc-el.a.run.app" });
    expect(seen[0].headers.get("x-forwarded-host")).toBe("w.example.workers.dev");
  });
});
