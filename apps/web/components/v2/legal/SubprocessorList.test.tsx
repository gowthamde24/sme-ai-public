import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Subprocessors } from "@/lib/dpdp/types";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
const jarValues: Record<string, string> = {};
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name in jarValues ? { name, value: jarValues[name] } : undefined) }), headers: async () => ({ get: () => null }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/privacy" }));
const subs = vi.fn();
vi.mock("@/lib/api/dpdp", async (orig) => ({ ...(await orig<typeof import("@/lib/api/dpdp")>()), subprocessorsCached: () => subs() }));

import PrivacyPage from "@/app/(legal)/privacy/page";

import { SubprocessorList } from "./SubprocessorList";

const DATA: Subprocessors = { version: "2026-10-27", updatedOn: "2026-10-27", draft: true, items: [
  { id: "google_cloud", name: "Google Cloud", purpose: "Hosting of the app, its worker and files", country: "India (Mumbai)", data: "All app data", link: "https://cloud.google.com/terms/data-processing-addendum" },
  { id: "resend", name: "Resend", purpose: "Sending e-mail", country: "United States", data: "E-mail addresses", link: null },
] };
beforeEach(() => {
  for (const k of Object.keys(jarValues)) delete jarValues[k];
  subs.mockReset();
});
afterEach(cleanup);

describe("the companies in the Privacy notice (job DQ part 2)", () => {
  it("is a table from the API: each company with its purpose, country and data; the link opens in a new tab; the version and day are said", () => {
    render(<SubprocessorList data={DATA} lang="en" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Company", "What for", "Country", "What data"]);
    const rows = within(table).getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("th,td")].map((c) => c.textContent));
    expect(rows).toEqual([["Google Cloud", "Hosting of the app, its worker and files", "India (Mumbai)", "All app data"], ["Resend", "Sending e-mail", "United States", "E-mail addresses"]]);
    expect(screen.getByRole("link", { name: "Google Cloud" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("List version 2026-10-27, updated 27 October 2026.")).toBeInTheDocument();
  });
  it("when the list cannot be read it says so and gives the address: it never guesses a list", () => {
    render(<SubprocessorList data={null} lang="en" />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/could not be loaded just now. Write to privacy@stack19.com/)).toBeInTheDocument();
    cleanup();
    render(<SubprocessorList data={{ ...DATA, items: [] }} lang="en" />);
    expect(screen.queryByRole("table")).toBeNull();
  });
  it.each(["te", "hi", "kn"] as const)("%s: the headings are in that language, the companies stay as the API wrote them", (lang) => {
    render(<SubprocessorList data={DATA} lang={lang} />);
    const heads = within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent ?? "");
    expect(heads.every((h) => !/^[A-Za-z ]+$/.test(h))).toBe(true);
    expect(screen.getByText("Google Cloud")).toBeInTheDocument();
  });
  it("the Privacy page draws the list in section 5, after its first paragraph, and the page works without it", async () => {
    subs.mockResolvedValue(DATA);
    render(await PrivacyPage());
    const section = document.getElementById("share")!;
    expect(within(section).getByRole("table")).toBeInTheDocument();
    expect(section.textContent!.indexOf("always the list in use")).toBeLessThan(section.textContent!.indexOf("Google Cloud"));
    cleanup();
    subs.mockRejectedValue(new Error("down"));
    render(await PrivacyPage());
    expect(document.getElementById("share")!.textContent).toContain("could not be loaded just now");
    expect(document.querySelector("h1")).toHaveTextContent("Privacy notice");
  });
});
