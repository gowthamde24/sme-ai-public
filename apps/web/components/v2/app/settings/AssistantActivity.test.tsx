import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { fixtureTransport, type WorkTransport } from "@/lib/assistant-work/client";
import { ACTIVITY_JSON, FIXTURE_NOW, TENANT_BASE } from "@/lib/assistant-work/fixtures";
import { parseActivity } from "@/lib/assistant-work/types";
import { readActivity } from "@/lib/assistant-work/source";

import { AssistantActivity, whenText } from "./AssistantActivity";

// the made-up answers are a chunk of their own (loaded on first use): loaded once here, so each test sees answers at the pace it expects
beforeAll(async () => void (await import("@/lib/assistant-work/fixture-transport")));

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("asstact.")));
const TE = Object.fromEntries(Object.entries(appDict("te") as Record<string, string>).filter(([k]) => k.startsWith("asstact.")));
const ENTRIES = parseActivity(ACTIVITY_JSON)?.items ?? [];
const draw = (p: Partial<Parameters<typeof AssistantActivity>[0]> = {}) => render(<AssistantActivity entries={ENTRIES} range="week" words={WORDS} lang="en" base={TENANT_BASE} canUndo mode="on" transport={fixtureTransport({ delay: 0 })} {...p} />);
afterEach(cleanup);

describe("Settings > Activity", () => {
  it("lists what the assistant did, by whose request, what changed and when, with its state", () => {
    draw();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("Added 31 leads from leads-guntur-nov.xlsx")).toBeTruthy();
    expect(screen.getAllByText(/By the assistant, on Srinivas Reddy’s request/)).toHaveLength(4);
    expect(screen.getByText("What changed: 9:30 am – 8:00 pm → 10:00 am – 7:00 pm")).toBeTruthy();
    expect(screen.getByText("Didn’t work")).toBeTruthy();
    expect(screen.getAllByText("4 Nov, 2:10 pm")).toHaveLength(1);
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("Undo only where the action declares it, and only for the Owner; after Undo it says Undone", async () => {
    draw();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2);
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Undo" })[0]));
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
    expect(document.querySelector("[data-activity='lead-imports.commit']")?.getAttribute("data-status")).toBe("undone");
    cleanup();
    draw({ canUndo: false });
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
  it("a refused undo says why in words", async () => {
    const transport: WorkTransport = { ...fixtureTransport({ delay: 0 }), undoAction: async () => ({ ok: false, error: "expired" }) };
    draw({ transport });
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Undo" })[0]));
    expect(screen.getByRole("alert").textContent).toBe("Too late to undo this here.");
  });
  it("the filter is two links (today, this week); an empty list and an unreadable one say so", () => {
    draw({ entries: [], range: "today" });
    expect(screen.getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "This week" }).getAttribute("href")).toBe(`${TENANT_BASE}/settings?section=activity&range=week`);
    expect(screen.getByText("Nothing yet today.")).toBeTruthy();
    cleanup();
    draw({ entries: null });
    expect(screen.getByText("Not available yet.")).toBeTruthy();
  });
  it("example mode says the entries are examples; Telugu words and dates", () => {
    draw({ mode: "mock", words: TE, lang: "te" });
    expect(screen.getByRole("note").textContent).toBe(TE["asstact.example"]);
    expect(whenText("te", "2026-11-04T08:40:00Z")).toMatch(/^4 .+, 2:10 pm$/);
  });
  it("the mock list is judged against the fixtures' own clock: today is today's, the week is the week's", async () => {
    expect((await readActivity("mock", { token: "t", tenantId: "x" }, "today"))?.map((e) => e.tool)).toEqual(["lead-imports.commit", "calls.set_hours"]);
    expect(await readActivity("mock", { token: "t", tenantId: "x" }, "week", FIXTURE_NOW)).toHaveLength(4);
  });
});
