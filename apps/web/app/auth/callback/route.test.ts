// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchange = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession: (...a: unknown[]) => exchange(...a) } }) }));

import { GET } from "./route";

const ask = (qs: string) => GET(new NextRequest(`https://app.example.test/auth/callback${qs}`));
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
    expect(new URL(res.headers.get("location")!).host).toBe("app.example.test"); // never an open redirect
  });
  it("sends a missing, over-long, refused or reused code back to sign-in with one closed word, and echoes nothing", async () => {
    for (const qs of ["", "?error=access_denied&error_description=<script>", `?code=${"x".repeat(513)}`]) {
      const res = await ask(qs);
      expect(res.headers.get("location")).toBe("https://app.example.test/login?notice=provider");
    }
    expect(exchange).not.toHaveBeenCalled();
    exchange.mockResolvedValue({ error: { message: "invalid grant" } });
    const res = await ask("?code=used-before");
    expect(res.headers.get("location")).toBe("https://app.example.test/login?notice=provider");
    expect(res.headers.get("location")).not.toContain("invalid");
  });
});
