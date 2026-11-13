import { describe, expect, it } from "vitest";

import { OPTIONAL_STEPS, STEP_IDS, STEP_MINUTES, TOTAL_MINUTES, doneCount, showChecklist, showChip, stepHref, stepViews } from "./steps";

describe("the seven steps", () => {
  it("are shop details, catalogue and prices, how it speaks, rules, practise, phone number, enquiry sources: about 15 minutes", () => {
    expect(STEP_IDS).toEqual(["shop", "catalogue", "speaks", "rules", "practise", "phone", "sources"]);
    expect(TOTAL_MINUTES).toBe(15);
    for (const id of STEP_IDS) expect(STEP_MINUTES[id]).toBeGreaterThan(0);
  });
  it("marks steps 3 to 5 optional (the assistant starts with working defaults)", () => {
    expect([...OPTIONAL_STEPS].sort()).toEqual(["practise", "rules", "speaks"]);
    const v = stepViews({}, "/app/tenants/T");
    expect(v.map((s) => s.optional)).toEqual([false, false, true, true, true, false, false]);
  });
  it("ticks the done ones and highlights the first one not done", () => {
    const v = stepViews({ shop: true, catalogue: true, phone: true }, "/app/tenants/T");
    expect(v.filter((s) => s.done).map((s) => s.id)).toEqual(["shop", "catalogue", "phone"]);
    expect(v.filter((s) => s.current).map((s) => s.id)).toEqual(["speaks"]);
    expect(doneCount(v)).toBe(3);
  });
  it("has no current step when all seven are done", () => {
    const all = Object.fromEntries(STEP_IDS.map((id) => [id, true]));
    const v = stepViews(all, "/app/tenants/T");
    expect(v.some((s) => s.current)).toBe(false);
    expect(doneCount(v)).toBe(7);
  });
  it("opens existing pages inside the workspace", () => {
    for (const id of STEP_IDS) expect(stepHref(id, "/app/tenants/T")).toMatch(/^\/app\/tenants\/T\//);
  });
});

describe("when Today shows the checklist", () => {
  const base = { live: false, choice: "open" as const, reopen: false, manages: true };
  it("until the assistant is live, for the people who set the business up", () => {
    expect(showChecklist(base)).toBe(true);
    expect(showChecklist({ ...base, live: true })).toBe(false);
    expect(showChecklist({ ...base, manages: false })).toBe(false);
  });
  it("not after Skip for now or after the chip was put away; the chip's link reopens it, even when live", () => {
    expect(showChecklist({ ...base, choice: "skipped" })).toBe(false);
    expect(showChecklist({ ...base, choice: "dismissed" })).toBe(false);
    expect(showChecklist({ ...base, choice: "skipped", reopen: true })).toBe(true);
    expect(showChecklist({ ...base, live: true, reopen: true })).toBe(true);
    expect(showChecklist({ ...base, manages: false, reopen: true })).toBe(false);
  });
});

describe("the Finish setup chip", () => {
  const base = { done: 3, choice: "skipped" as const, checklistShown: false, manages: true };
  it("shows on the normal Today while steps are left", () => {
    expect(showChip(base)).toBe(true);
  });
  it("disappears when all seven are done, when it was dismissed, while the checklist is shown, and for people who do not set up", () => {
    expect(showChip({ ...base, done: 7 })).toBe(false);
    expect(showChip({ ...base, choice: "dismissed" })).toBe(false);
    expect(showChip({ ...base, checklistShown: true })).toBe(false);
    expect(showChip({ ...base, manages: false })).toBe(false);
  });
});
