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
const signedOut = () => ({ response: NextResponse.next(), user: null });
const signedIn = () => ({ response: NextResponse.next(), user: { id: "u" } });

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
    refreshSession.mockResolvedValue({ response, user: null });

    const redirect = await proxy(request("/app"));
    expect(redirect.cookies.get("sb-access-token")?.value).toBe("new");
    expect(redirect.headers.get("cache-control")).toBe("private, no-store");
  });

  it("only runs on the routes that need a session", () => {
    expect(config.matcher).toEqual(["/app/:path*", "/login"]);
  });
});
