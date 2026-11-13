import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isNotFound, notFoundMock } from "@/test/helpers";

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));

import RefundPolicyPage, { generateMetadata } from "./page";

beforeEach(() => vi.stubEnv("LEGAL_DRAFT_PAGES", "1"));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("/refund-policy: a DRAFT (owner's D13), only where LEGAL_DRAFT_PAGES is on", () => {
  it.each([[""], ["0"], ["true"]])("flag %j: a plain 404", async (value) => {
    vi.stubEnv("LEGAL_DRAFT_PAGES", value);
    expect(await isNotFound(() => RefundPolicyPage())).toBe(true);
  });

  it("on: the policy under the draft banner, with the facts filled in and no {token} left", async () => {
    render(await RefundPolicyPage());
    expect(document.querySelector('[data-legal="draft-banner"]')).toHaveTextContent("Draft, pending legal review");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Refund and Cancellation Policy");
    const text = document.body.textContent ?? "";
    expect(text).toContain("billing@stack19.com");
    expect(text).toContain("14 days");
    expect(text).not.toMatch(/\{[a-z_]+\}/);
  });

  it("is never indexed", async () => {
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false });
  });
});
