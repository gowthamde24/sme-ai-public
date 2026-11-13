import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));

import { GET } from "./route";

const call = (page?: string) => GET(new NextRequest(`http://localhost/app/support/whatsapp${page === undefined ? "" : `?page=${encodeURIComponent(page)}`}`));
beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "t" });
});

describe("the support chat from a page's '?' (a redirect to OUR number, signed-in people only)", () => {
  it("answers 302 to our WhatsApp with one fixed sentence naming the screen", async () => {
    const res = await call("calls");
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("Location") ?? "");
    expect(url.origin + url.pathname).toBe("https://wa.me/919502380998");
    expect(url.searchParams.get("text")).toBe("Hi Stack19 support, I need help with calls.");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await res.text()).toBe("");
  });
  it("nothing typed by the person reaches the address: an unknown page is 'the app'", async () => {
    for (const page of ["<script>alert(1)</script>", "calls&text=evil", "", "../../etc"]) {
      const text = new URL((await call(page)).headers.get("Location") ?? "").searchParams.get("text");
      expect(text, page).toBe("Hi Stack19 support, I need help with the app.");
    }
    expect(new URL((await call()).headers.get("Location") ?? "").searchParams.get("text")).toBe("Hi Stack19 support, I need help with the app.");
  });
  it("needs a signed-in person (the login redirect from requireUser)", async () => {
    requireUser.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT:/login");
    });
    await expect(call("calls")).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
