import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { fixtureTransport } from "@/lib/assistant-work/client";
import { IMPORT_DRAFT_JSON } from "@/lib/assistant-work/fixtures";
import { importDraftToWire, parseImportDraft, parsePlan, parseWorkCard, planToWire } from "@/lib/assistant-work/types";

import { makeT } from "../../../words";
import { WorkCards } from "./WorkCards";
import type { WorkEnv } from "./work-env";
import { createWorkStore } from "./work-store";

beforeAll(async () => void (await import("@/lib/assistant-work/fixture-transport")));
afterEach(cleanup);

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("bv.")));
const BASE = "/app/tenants/c029cba3-d2f8-4923-8c5a-630852797fd3";

function draw(json: unknown = IMPORT_DRAFT_JSON) {
  const card = parseWorkCard(json, BASE);
  if (!card) throw new Error("fixture does not parse");
  const env: WorkEnv = { t: makeT(WORDS), role: "owner", transport: fixtureTransport({ delay: 0 }), store: createWorkStore(), onChange: () => undefined };
  return render(<WorkCards cards={[card]} env={env} />);
}
const cellOf = (row: string, key: string) => document.querySelector(`[data-row="${row}"] [data-cell="${key}"]`) as HTMLInputElement;
const click = async (name: string | RegExp) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));

describe("the editable import preview", () => {
  it("shows the counts, says it was read from handwriting, and highlights the cells it was unsure of", () => {
    draw();
    expect(screen.getByText("6 rows found · 1 already in Leads · 1 without a valid phone number · 5 to check")).toBeTruthy();
    expect(document.querySelector('[data-read-by="ai_handwriting"]')?.textContent).toBe("I read this from handwriting, so every cell needs a quick look.");
    expect(cellOf("r1", "interest").dataset.unsure).toBe("true");
    expect(cellOf("r1", "name").dataset.unsure).toBeUndefined();
    expect(cellOf("r6", "phone").getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector('[data-row="r5"]')?.textContent).toContain("Already in Leads as Ravi T., so it is left out");
  });

  it("an edited cell is saved, is no longer unsure, and the count of cells to check goes down", async () => {
    draw();
    await act(async () => {
      fireEvent.change(cellOf("r1", "interest"), { target: { value: "Kanchi pattu sarees" } });
      fireEvent.blur(cellOf("r1", "interest"));
    });
    await waitFor(() => expect(cellOf("r1", "interest").dataset.unsure).toBeUndefined());
    expect(cellOf("r1", "interest").value).toBe("Kanchi pattu sarees");
    expect(screen.getByText(/4 to check/)).toBeTruthy();
  });

  it("a fixed phone number brings the row back in; a bad one stays out", async () => {
    draw();
    expect(document.querySelector('[data-row="r6"]')?.getAttribute("data-included")).toBe("false");
    await act(async () => {
      fireEvent.change(cellOf("r6", "phone"), { target: { value: "98765 43210" } });
      fireEvent.blur(cellOf("r6", "phone"));
    });
    await waitFor(() => expect(document.querySelector('[data-row="r6"]')?.getAttribute("data-included")).toBe("true"));
    expect(cellOf("r6", "phone").value).toBe("+919876543210");
  });

  it("Add needs the consent source first (nobody is called or messaged without one); then it gives the plan, and nothing is written before the plan's own Do it", async () => {
    draw();
    const add = screen.getByRole("button", { name: "Add 4 leads" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(document.querySelector('[data-import="consent"]')?.textContent).toContain("Where do these people come from?");
    fireEvent.click(screen.getByRole("radio", { name: "They asked us to contact them" }));
    expect((screen.getByRole("button", { name: "Add 4 leads" }) as HTMLButtonElement).disabled).toBe(false);
    await click("Add 4 leads");
    const pv = await screen.findByRole("button", { name: "Do it" });
    expect(pv).toBeTruthy();
    expect(document.body.textContent).toContain("Add 4 new leads from IMG_2041.jpg");
    // the card is locked now: no more edits
    expect(cellOf("r1", "name").disabled).toBe(true);
  });

  it("leaving a row out changes the number on the button", async () => {
    draw();
    await act(async () => void fireEvent.click(within(document.querySelector('[data-row="r4"]') as HTMLElement).getByRole("checkbox")));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add 3 leads" })).toBeTruthy());
  });

  it("sending the same file to the prices swaps the table and drops the consent step", async () => {
    draw();
    await click("Prices");
    await waitFor(() => expect(document.querySelector('[data-cell="item"]')).not.toBeNull());
    expect(document.querySelector('[data-import="consent"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Update 3 prices" })).toBeTruthy();
    expect(document.querySelector('[data-destination-choice="prices"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("deleting the file says nothing was added", async () => {
    draw();
    await click("Delete the file now");
    await waitFor(() => expect(screen.getByText("Deleted. Nothing was added.")).toBeTruthy());
  });

  it("says we keep the original and for how long", () => {
    draw();
    expect(document.body.textContent).toContain("We keep the original for 90 days, private to your business, and then delete it. You can delete it now.");
  });
});

describe("the import and plan wire shapes", () => {
  it("a parsed plan and a parsed import survive the route's round trip (the browser parses them again)", () => {
    const draft = parseImportDraft(IMPORT_DRAFT_JSON);
    expect(draft).not.toBeNull();
    expect(parseImportDraft(JSON.parse(JSON.stringify(importDraftToWire(draft!))))).toEqual(draft);
    const plan = parsePlan({ plan_id: "a1000000-0000-4000-8000-000000000005", title: "x", steps: [{ tool: "a", summary: "b", undoable: true, status: "proposed", error: null }], status: "proposed", sensitive: null, owner_only: false, needs_second_factor: false, expires_at: null });
    expect(parsePlan(JSON.parse(JSON.stringify(planToWire(plan!))))).toEqual(plan);
  });
  it("a card with no usable columns, and an import without its id, are not drawn as an editable preview", () => {
    expect(parseImportDraft({ ...IMPORT_DRAFT_JSON, columns: [] })).toBeNull();
    expect(parseImportDraft({ ...IMPORT_DRAFT_JSON, import_id: "nope" })).toBeNull();
  });
});
