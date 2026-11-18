import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));

import { appT } from "@/i18n/app";
import { ApiRequestError } from "@/lib/api/client";

import { refusal } from "./finder-guard";

describe("a second free search in the month (C1: 403 free_search_used, also when the search is approved; owner, 18 Nov 2026)", () => {
  it("says the used-up sentence, with no price", () => {
    const r = refusal(new ApiRequestError(403, "free_search_used", "x"), appT("en"), "en");
    expect(r.error).toBe("You've used this month's free search. More searches come with Sales Assistant + Lead Finder.");
    expect(r.error).not.toMatch(/₹/);
  });
});
