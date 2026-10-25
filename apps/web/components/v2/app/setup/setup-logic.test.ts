import { describe, expect, it } from "vitest";

import { firstOpenStep, isFresh, itemsOf, NEW_LOCAL, STEPS, viewOf, type Local } from "./setup-logic";
import { defaultHours, fresh } from "./setup-test-kit";

const L = (o: Partial<Local> = {}): Local => ({ ...NEW_LOCAL, ...o });
const saved = { settings: { ...defaultHours, is_default: false }, saved: true };

describe("setup logic (job BJ)", () => {
  it("the steps are shop, hours, saree, Vijaya, ready (no invitation step: the API has none)", () => {
    expect(STEPS).toEqual(["shop", "hours", "saree", "agent", "ready"]);
  });
  it("a workspace is brand new only when the hours were never saved AND the catalogue is empty, both read", () => {
    expect(isFresh(fresh())).toBe(true);
    expect(isFresh(fresh({ hours: saved }))).toBe(false);
    expect(isFresh(fresh({ sarees: 1 }))).toBe(false);
    expect(isFresh(fresh({ hours: null }))).toBe(false); // a failed read is never "new"
    expect(isFresh(fresh({ sarees: null }))).toBe(false);
  });
  it("the items are read from the API's data, plus what this device saw; unknown is not done", () => {
    expect(itemsOf(fresh(), L()).map((i) => [i.id, i.done])).toEqual([["hours", false], ["saree", false], ["agent", false]]);
    expect(itemsOf(fresh({ hours: saved, sarees: 3 }), L({ agentSeen: true })).every((i) => i.done)).toBe(true);
    expect(itemsOf(fresh({ hours: null, sarees: null }), L({ hoursDone: true, sareeDone: true })).filter((i) => i.done).map((i) => i.id)).toEqual(["hours", "saree"]);
    expect(itemsOf(fresh(), L()).map((i) => i.step)).toEqual([1, 2, 3]);
  });
  it("a new workspace shows the wizard; skipped or finished shows the checklist; hidden or all done shows Today as it is", () => {
    expect(viewOf(fresh(), L())).toBe("wizard");
    expect(viewOf(fresh(), L({ state: "skipped" }))).toBe("checklist");
    expect(viewOf(fresh(), L({ state: "done" }))).toBe("checklist");
    expect(viewOf(fresh(), L({ state: "dismissed" }))).toBe("plain");
    expect(viewOf(fresh({ hours: saved, sarees: 2 }), L({ agentSeen: true }))).toBe("plain");
    expect(viewOf(fresh({ hours: saved, sarees: 2 }), L({ state: "skipped", agentSeen: true }))).toBe("plain");
  });
  it("an established workspace (hours saved or sarees there) gets the checklist, not the wizard", () => {
    expect(viewOf(fresh({ hours: saved }), L())).toBe("checklist");
    expect(viewOf(fresh({ sarees: 4 }), L())).toBe("checklist");
  });
  it("when the facts cannot be read there is no wizard (Today is never blocked on a failed read)", () => {
    expect(viewOf(fresh({ hours: null, sarees: null }), L())).toBe("checklist");
  });
  it("RESUME: a person who has gone past the first step stays in the wizard, even after what they saved makes the facts say 'not new', and even when the last step marks itself seen", () => {
    expect(viewOf(fresh({ hours: saved }), L({ step: 2 }))).toBe("wizard");
    expect(viewOf(fresh({ hours: saved, sarees: 1 }), L({ step: 4, agentSeen: true }))).toBe("wizard");
    expect(viewOf(fresh(), L({ step: 3, state: "skipped" }))).toBe("checklist"); // skipping leaves it
  });
  it("'Continue setup' opens the first thing left, or the first step when nothing is", () => {
    expect(firstOpenStep(itemsOf(fresh(), L()))).toBe(1);
    expect(firstOpenStep(itemsOf(fresh({ hours: saved }), L()))).toBe(2);
    expect(firstOpenStep(itemsOf(fresh({ hours: saved, sarees: 1 }), L()))).toBe(3);
    expect(firstOpenStep(itemsOf(fresh({ hours: saved, sarees: 1 }), L({ agentSeen: true })))).toBe(0);
  });
});
