// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshSession = vi.fn();
vi.mock("@/lib/supabase/proxy-session", () => ({
  refreshSession: (r: NextRequest) => refreshSession(r),
}));

import { config, proxy } from "./proxy";

const request = (path: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"));
const signedOut = () => ({
  response: NextResponse.next(),
  user: null,
  needsSecondFactor: false,
});
const signedIn = () => ({
  response: NextResponse.next(),
  user: { id: "u" },
  needsSecondFactor: false,
});

describe("proxy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends signed-out visitors of /app to /login with a relative next target", async () => {
    refreshSession.mockResolvedValue(signedOut());
    const response = await proxy(request("/app/tenants?x=1"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/app/tenants?x=1");
    expect(location.origin).toBe("http://localhost:3000");
  });

  it("covers /app itself", async () => {
    refreshSession.mockResolvedValue(signedOut());
    const response = await proxy(request("/app"));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/login",
    );
  });

  it("lets signed-in users through /app", async () => {
    refreshSession.mockResolvedValue(signedIn());
    const response = await proxy(request("/app"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("sends signed-in users away from /login", async () => {
    refreshSession.mockResolvedValue(signedIn());
    const response = await proxy(request("/login"));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/app",
    );
  });

  it("lets signed-out users reach /login", async () => {
    refreshSession.mockResolvedValue(signedOut());
    const response = await proxy(request("/login"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("carries refreshed session cookies onto a redirect", async () => {
    const response = NextResponse.next();
    response.cookies.set("sb-access-token", "new", { httpOnly: true });
    response.headers.set("cache-control", "private, no-store");
    refreshSession.mockResolvedValue({ response, user: null, needsSecondFactor: false });

    const redirect = await proxy(request("/app"));
    expect(redirect.cookies.get("sb-access-token")?.value).toBe("new");
    expect(redirect.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sends an enrolled person on a password-only session to the challenge, keeping where they were going", async () => {
    refreshSession.mockResolvedValue({ ...signedIn(), needsSecondFactor: true });
    const response = await proxy(request("/app/tenants/1?x=2"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/mfa");
    expect(location.searchParams.get("next")).toBe("/app/tenants/1?x=2");
  });

  it("does not trap the challenge page itself", async () => {
    refreshSession.mockResolvedValue({ ...signedIn(), needsSecondFactor: true });
    expect((await proxy(request("/auth/mfa"))).headers.get("location")).toBeNull();
  });

  it("every page gets a Content-Security-Policy with a fresh nonce, redirects included", async () => {
    refreshSession.mockResolvedValue(signedOut());
    const nonces = new Set<string>();
    for (const path of ["/", "/login", "/auth/forgot", "/app", "/nope"]) {
      const response = await proxy(request(path));
      const csp = response.headers.get("content-security-policy") ?? "";
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce, path).toBeTruthy();
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      nonces.add(nonce as string);
    }
    expect(nonces.size).toBe(5);
  });

  it("hands the nonce and the policy to the renderer on the REQUEST", async () => {
    refreshSession.mockResolvedValue(signedOut());
    const req = request("/login");
    await proxy(req);
    expect(req.headers.get("x-nonce")).toBeTruthy();
    expect(req.headers.get("content-security-policy")).toContain(`'nonce-${req.headers.get("x-nonce")}'`);
  });

  it("does not touch the session for pages that need none", async () => {
    await proxy(request("/"));
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("covers pages but not static assets, the API prefix or prefetches", () => {
    const [entry] = config.matcher as { source: string; missing: { key: string }[] }[];
    const re = new RegExp(`^${entry.source}$`);
    for (const yes of ["/", "/login", "/app", "/app/tenants/1", "/auth/confirm"]) expect(re.test(yes), yes).toBe(true);
    for (const no of ["/_next/static/x.js", "/_next/image", "/favicon.ico", "/api/x"]) expect(re.test(no), no).toBe(false);
    expect(entry.missing.map((m) => m.key)).toContain("next-router-prefetch");
  });
});
