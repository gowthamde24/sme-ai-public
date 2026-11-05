import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { fixtureTransport, type WorkTransport } from "@/lib/assistant-work/client";
import { CANT_DO_JSON, CATALOGUE_PREVIEW_JSON, HOURS_PLAN_JSON, IMPORT_PLAN_JSON, MULTI_PLAN_JSON, NOT_IN_PLAN_JSON, NOT_YET_JSON, PREVIEW_JSON, SECRET_JSON, SETUP_EMAIL_JSON, SETUP_FORM_JSON, SETUP_INDIAMART_JSON, STAFF_PLAN_JSON, TENANT_BASE, planCardJson } from "@/lib/assistant-work/fixtures";
import { parseWorkCard, type WorkCard } from "@/lib/assistant-work/types";

import { makeT } from "../../../words";
import { WorkCards } from "./WorkCards";
import type { WorkEnv, WorkRole } from "./work-env";
import { createWorkStore } from "./work-store";

// the made-up answers are a chunk of their own (loaded on first use): loaded once here, so each test sees answers at the pace it expects
beforeAll(async () => void (await import("@/lib/assistant-work/fixture-transport")));

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("bv.")));
const card = (json: unknown): WorkCard => {
  const c = parseWorkCard(json, TENANT_BASE);
  if (!c) throw new Error("fixture does not parse");
  return c;
};
function draw(cards: WorkCard[], { role = "owner", transport = fixtureTransport({ delay: 0 }, [IMPORT_PLAN_JSON, HOURS_PLAN_JSON, STAFF_PLAN_JSON, MULTI_PLAN_JSON, CATALOGUE_PREVIEW_JSON.plan]), onChange = vi.fn() }: { role?: WorkRole; transport?: WorkTransport; onChange?: (t: string) => void } = {}) {
  const env: WorkEnv = { t: makeT(WORDS), role, transport, store: createWorkStore(), onChange };
  return { ...render(<WorkCards cards={cards} env={env} />), env, onChange };
}
const click = async (name: string | RegExp) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));

afterEach(cleanup);

describe("the file preview card", () => {
  it("says what was found, a few rows, where it goes, that nobody is contacted, and the plan", () => {
    draw([card(PREVIEW_JSON)]);
    const pv = screen.getByRole("article", { name: "What I found in leads-guntur-nov.xlsx" });
    expect(within(pv).getByText("38 found · 4 already exist · 2 no phone · 1 looks like a supplier")).toBeTruthy();
    expect(pv.textContent).toContain("Lakshmi Prasanna");
    expect(pv.textContent).toContain("Goes to: Leads");
    expect(pv.textContent).toContain("Nobody is messaged or called because of this.");
    expect(within(pv).getByRole("button", { name: "Do it" })).toBeTruthy();
  });
  it("a file read from a picture (a scan or a photo) asks to check the names and numbers; a file's own cells, or an older card without read_by, does not", () => {
    for (const readBy of ["local_ocr", "ai"]) {
      cleanup();
      draw([card({ ...PREVIEW_JSON, read_by: readBy })]);
      expect(document.querySelector(`[data-read-by="${readBy}"]`)?.textContent).toBe("Read from the picture: check the names and numbers before you say yes.");
    }
    for (const json of [{ ...PREVIEW_JSON, read_by: "file" }, PREVIEW_JSON, { ...PREVIEW_JSON, read_by: "something_new" }]) {
      cleanup();
      draw([card(json)]);
      expect(document.querySelector("[data-read-by]")).toBeNull();
    }
  });
  it("a price list says what changes: Item, Now and New, and the counts in their own words", () => {
    draw([card({ ...CATALOGUE_PREVIEW_JSON, facts: [{ code: "not_in_catalogue", n: 1 }, { code: "unchanged", n: 12 }, { code: "changed", n: 6 }, { code: "found", n: 19 }], columns: ["Item", "Now", "New"], rows: [["Kanjivaram Red", "—", "₹12,000"]] })]);
    expect(screen.getByText("19 found · 6 prices change · 12 stay the same · 1 not in your catalogue")).toBeTruthy();
    expect(document.querySelector('[data-work="rows"]')?.textContent).toContain("New: ₹12,000");
  });
  it("a catalogue preview is a money plan: the Owner confirms twice", async () => {
    draw([card(CATALOGUE_PREVIEW_JSON)]);
    expect(screen.getByText(/24 found · 18 already exist · 2 no price/)).toBeTruthy();
    await click("Do it");
    expect(screen.getByRole("group", { name: "Are you sure?" }).textContent).toContain("This changes prices or money.");
  });
});

describe("the plan card", () => {
  it("Do it runs it: 'Done · Undo', then Undo makes it 'Undone'", async () => {
    draw([card(planCardJson(IMPORT_PLAN_JSON))]);
    await click("Do it");
    expect(screen.getByRole("status").textContent).toContain("Done");
    await click("Undo");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.getByText("Undone", { selector: "[data-work=state]" })).toBeTruthy();
  });
  it("shows no Undo when no step that ran declares one", async () => {
    draw([card(planCardJson(STAFF_PLAN_JSON))]);
    await click("Do it");
    await click("Yes, do it");
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
  it("a sensitive plan needs the explicit second step; Go back returns without running", async () => {
    const transport = fixtureTransport({ delay: 0 }, [STAFF_PLAN_JSON]);
    const decide = vi.spyOn(transport, "decide");
    draw([card(planCardJson(STAFF_PLAN_JSON))], { transport });
    await click("Do it");
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Are you sure?" }).textContent).toContain("This changes who is in your team or what they can do.");
    await click("Go back");
    expect(screen.queryByRole("group", { name: "Are you sure?" })).toBeNull();
    await click("Do it");
    await click("Yes, do it");
    expect(decide).toHaveBeenCalledWith(STAFF_PLAN_JSON.plan_id, "do", true);
  });
  it("someone who is not the Owner reads 'Only the owner can approve this' and has no button for an owner-only or sensitive plan", () => {
    draw([card(planCardJson(STAFF_PLAN_JSON)), card(planCardJson(HOURS_PLAN_JSON))], { role: "sales" });
    expect(screen.getAllByText("Only the owner can approve this.")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Do it" })).toBeNull();
  });
  it("Staff may run a plain plan that is not the Owner's alone", async () => {
    draw([card(planCardJson(IMPORT_PLAN_JSON))], { role: "sales" });
    await click("Do it");
    expect(screen.getByText("Done")).toBeTruthy();
  });
  it("Change puts words in the composer and leaves the plan waiting; Cancel says nothing changed", async () => {
    const { onChange } = draw([card(planCardJson(IMPORT_PLAN_JSON))]);
    await click("Change");
    expect(onChange).toHaveBeenCalledWith("Change the plan: ");
    expect(screen.getByRole("button", { name: "Do it" })).toBeTruthy();
    await click("Cancel");
    expect(screen.getByText("Cancelled. Nothing was changed.")).toBeTruthy();
  });
  it("a multi-step plan lists every step; a step that failed says so, the others are done", async () => {
    draw([card(planCardJson(MULTI_PLAN_JSON))], { transport: fixtureTransport({ delay: 0, failTools: ["auto_reply.sunday_off"] }, [MULTI_PLAN_JSON]) });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    await click("Do it");
    expect(screen.getByText("Partly done")).toBeTruthy();
    const failed = document.querySelector("[data-work=step][data-status=failed]");
    expect(failed?.textContent).toContain("Didn’t work · some details were not right");
    expect(document.querySelectorAll("[data-work=step][data-status=done]")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });
  it("when every step failed it says nothing was changed", async () => {
    draw([card(planCardJson(HOURS_PLAN_JSON))], { transport: fixtureTransport({ delay: 0, failTools: ["calls.set_hours"] }, [HOURS_PLAN_JSON]) });
    await click("Do it");
    expect(screen.getByText("It didn’t work. Nothing was changed.")).toBeTruthy();
  });
  it("a refusal from the API is said in words and the plan waits again", async () => {
    const transport: WorkTransport = { ...fixtureTransport({ delay: 0 }), decide: async () => ({ ok: false, error: "mfa" }) };
    draw([card(planCardJson(IMPORT_PLAN_JSON))], { transport });
    await click("Do it");
    expect(screen.getByRole("alert").textContent).toBe(WORDS["bv.chat.err.mfa"]);
    expect(screen.getByRole("button", { name: "Do it" })).toBeTruthy();
  });
  it("an expired plan says so", async () => {
    const transport: WorkTransport = { ...fixtureTransport({ delay: 0 }), decide: async () => ({ ok: false, error: "expired" }) };
    draw([card(planCardJson(IMPORT_PLAN_JSON))], { transport });
    await click("Do it");
    expect(screen.getByText("This plan has expired. Nothing was changed. Ask again.")).toBeTruthy();
  });
});

describe("the secure key box", () => {
  const KEY = "IM-CRM-4f9e2b77c1d0-7781";
  it("is a masked input with nothing remembered, and the value goes only to its own call", async () => {
    const transport = fixtureTransport({ delay: 0 });
    const save = vi.spyOn(transport, "saveSecret");
    const { container } = draw([card(SECRET_JSON)], { transport });
    const input = screen.getByLabelText("IndiaMART CRM key") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.autocomplete).toBe("off");
    expect(input.getAttribute("name")).toBeNull();
    fireEvent.change(input, { target: { value: KEY } });
    await click("Save securely");
    expect(save).toHaveBeenCalledWith(SECRET_JSON.request_id, KEY);
    expect(screen.getByRole("status").textContent).toBe("Saved · ••••7781");
    expect(container.innerHTML).not.toContain(KEY);
    expect(container.innerHTML).not.toContain("4f9e2b77");
    expect(screen.queryByLabelText("IndiaMART CRM key")).toBeNull();
  });
  it("says 'Saved' alone when the API returns no last four", async () => {
    const transport: WorkTransport = { ...fixtureTransport({ delay: 0 }), saveSecret: async () => ({ ok: true, last4: null }) };
    draw([card(SECRET_JSON)], { transport });
    fireEvent.change(screen.getByLabelText("IndiaMART CRM key"), { target: { value: KEY } });
    await click("Save securely");
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });
  it("a refused key empties the box and says so; nothing of the value stays on screen", async () => {
    const transport: WorkTransport = { ...fixtureTransport({ delay: 0 }), saveSecret: async () => ({ ok: false, error: "rejected" }) };
    const { container } = draw([card(SECRET_JSON)], { transport });
    const input = screen.getByLabelText("IndiaMART CRM key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: KEY } });
    await click("Save securely");
    expect(screen.getByRole("alert").textContent).toBe("That key was not accepted. Check it and try again.");
    expect(input.value).toBe("");
    expect(container.innerHTML).not.toContain(KEY);
  });
  it("a box that was used, ran out or was not saved takes nothing more: the form goes, and it says to ask again (C1, 5 Nov)", async () => {
    const transport: WorkTransport = { ...fixtureTransport({ delay: 0 }), saveSecret: async () => ({ ok: false, error: "renew" }) };
    const { container } = draw([card(SECRET_JSON)], { transport });
    fireEvent.change(screen.getByLabelText("IndiaMART CRM key"), { target: { value: KEY } });
    await click("Save securely");
    expect(screen.getByRole("alert").textContent).toBe("This box can't take the key any more. Ask me again for a new card.");
    expect(screen.queryByLabelText("IndiaMART CRM key")).toBeNull();
    expect(container.innerHTML).not.toContain(KEY);
  });
  it("a box past its time says so without sending the value", async () => {
    const transport = fixtureTransport({ delay: 0 });
    const save = vi.spyOn(transport, "saveSecret");
    draw([card({ ...SECRET_JSON, expires_at: "2020-01-01T00:00:00Z" })], { transport });
    fireEvent.change(screen.getByLabelText("IndiaMART CRM key"), { target: { value: KEY } });
    await click("Save securely");
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("This box can't take the key any more. Ask me again for a new card.");
  });
  it("only the Owner sees the box", () => {
    draw([card(SECRET_JSON)], { role: "admin" });
    expect(screen.queryByLabelText("IndiaMART CRM key")).toBeNull();
    expect(screen.getByText("Only the owner can save keys.")).toBeTruthy();
  });
});

describe("guided setup cards", () => {
  it("numbered steps, the key box and Pull now; the live test's result is said in words", async () => {
    draw([card(SETUP_INDIAMART_JSON)], { transport: fixtureTransport({ delay: 0, failTests: { [SETUP_INDIAMART_JSON.id]: "key_rejected" } }) });
    const setup = screen.getByRole("article", { name: "Connect IndiaMART" });
    expect(within(setup).getAllByRole("listitem").length).toBeGreaterThanOrEqual(4);
    expect(within(setup).getByLabelText("IndiaMART CRM key")).toBeTruthy();
    await click("Pull now");
    expect(screen.getByRole("status").textContent).toContain("It didn’t work: the key was not accepted.");
    expect(within(setup).getByRole("link", { name: "Open Lead sources" }).getAttribute("href")).toBe(`${TENANT_BASE}/lead-sources`);
  });
  it("the forwarding address to copy, per-portal steps and the last failed test with its detail", async () => {
    const write = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    draw([card(SETUP_EMAIL_JSON)]);
    expect(screen.getByText("leads.sri-lakshmi-silks@in.example.test")).toBeTruthy();
    expect(screen.getByText("JustDial")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("It didn’t work: nothing arrived yet.");
    await click("Copy");
    expect(write).toHaveBeenCalledWith("leads.sri-lakshmi-silks@in.example.test");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    await click("Send a test mail");
    expect(screen.getByRole("status").textContent).toBe("It works.");
  });
  it("the website snippet and a test that worked", () => {
    draw([card(SETUP_FORM_JSON)]);
    expect(screen.getByText(/forms\.example\.test\/f\/sri-lakshmi-silks/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("It works.");
  });
});

describe("can't do yet", () => {
  it("says so honestly, with the screen where a person does it", () => {
    draw([card(CANT_DO_JSON), card(NOT_YET_JSON)]);
    expect(screen.getByText("This is always done by a person, on its own screen.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Settings → Data" }).getAttribute("href")).toBe(`${TENANT_BASE}/settings?section=data`);
    expect(screen.getByText("I can’t do this yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Orders" })).toBeTruthy();
  });
  it("not in the plan: 'part of AI Workforce' with the Plans link, no price and no checkout (en and te)", () => {
    draw([card(NOT_IN_PLAN_JSON)]);
    const el = document.querySelector<HTMLElement>("[data-work=cant-do]") as HTMLElement;
    expect(el.dataset.reason).toBe("not_in_plan");
    expect(el.dataset.upgrade).toBe("ai_workforce");
    expect(within(el).getByText("Finding new customers is part of AI Workforce.")).toBeTruthy();
    expect(within(el).getByText("Finding new retailers in Guntur")).toBeTruthy();
    expect(within(el).getByRole("link", { name: "Open Plans" }).getAttribute("href")).toBe(`${TENANT_BASE}/plans`);
    expect(el.textContent).not.toMatch(/₹|Rs\.?\s?\d|price|pay|buy|checkout|trial/i);
    expect(within(el).queryAllByRole("button")).toHaveLength(0);
    expect((appDict("te") as Record<string, string>)["bv.work.cant.not_in_plan.ai_workforce"]).toBe("కొత్త కస్టమర్లను వెతకడం AI Workforce లో భాగం.");
  });
});

describe("a card remembers what happened to it when the thread draws it again", () => {
  it("a plan that ran is still done in a new element", async () => {
    const { env, unmount } = draw([card(planCardJson(IMPORT_PLAN_JSON))]);
    await click("Do it");
    unmount();
    render(<WorkCards cards={[card(planCardJson(IMPORT_PLAN_JSON))]} env={env} />);
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Do it" })).toBeNull();
  });
});
