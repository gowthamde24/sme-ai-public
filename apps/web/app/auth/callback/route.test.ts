// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchange = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession: (...a: unknown[]) => exchange(...a) } }) }));

import { SITE_URL } from "@/lib/seo/site";

import { GET } from "./route";

const ask = (qs: string) => GET(new NextRequest(`https://0.0.0.0:8080/auth/callback${qs}`)); // what the hosted server sees as its own address
beforeEach(() => {
  vi.clearAllMocks();
  exchange.mockResolvedValue({ error: null });
});

describe("the return from Google or Facebook", () => {
  it("swaps the one-time code for a session and goes to /app, whatever else the address says", async () => {
    const res = await ask("?code=abc123&next=https://evil.example/&redirect_to=//evil.example");
    expect(exchange).toHaveBeenCalledWith("abc123");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/app");
    expect(new URL(res.headers.get("location")!).origin).toBe(SITE_URL); // never an open redirect, and never the container's own address that `request.url` has behind Cloud Run
  });
  it("sends a missing, over-long, refused or reused code back to sign-in with one closed word, and echoes nothing", async () => {
    for (const qs of ["", "?error=access_denied&error_description=<script>", `?code=${"x".repeat(513)}`]) {
      const res = await ask(qs);
      expect(res.headers.get("location")).toBe(`${SITE_URL}/login?notice=provider`);
    }
    expect(exchange).not.toHaveBeenCalled();
    exchange.mockResolvedValue({ error: { message: "invalid grant" } });
    const res = await ask("?code=used-before");
    expect(res.headers.get("location")).toBe(`${SITE_URL}/login?notice=provider`);
    expect(res.headers.get("location")).not.toContain("invalid");
  });
  it("tells a Google address without an account (the Auth server's sign-up is off) apart, with its own closed word and no echo, and never swaps a code for it", async () => {
    const res = await ask("?error=unprocessable_entity&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance");
    expect(res.headers.get("location")).toBe(`${SITE_URL}/login?notice=nosignup`);
    expect(exchange).not.toHaveBeenCalled();
    const other = await ask("?error=server_error&error_code=unexpected_failure");
    expect(other.headers.get("location")).toBe(`${SITE_URL}/login?notice=provider`);
  });
});
