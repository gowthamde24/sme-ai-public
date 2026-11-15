import { describe, expect, it } from "vitest";

import { splitTabs } from "./tabs-more";

const page = (id: string) => ({ id });
const LEADS = ["leaddesk", "leads", "followups", "visits", "map", "retailers", "import", "sites"].map(page);

describe("the Leads row", () => {
  it("keeps the daily pages, puts Map, Find retailers and Sites under More, and drops the repeated Add leads", () => {
    const { shown, more } = splitTabs("v6-leads", LEADS, "leads");
    expect(shown.map((p) => p.id)).toEqual(["leaddesk", "leads", "followups", "visits"]);
    expect(more.map((p) => p.id)).toEqual(["map", "retailers", "sites"]);
  });
  it("always draws the open page as a tab, wherever it normally sits", () => {
    expect(splitTabs("v6-leads", LEADS, "import").shown.map((p) => p.id)).toContain("import");
    const onMap = splitTabs("v6-leads", LEADS, "map");
    expect(onMap.shown.map((p) => p.id)).toContain("map");
    expect(onMap.more.map((p) => p.id)).toEqual(["retailers", "sites"]);
  });
  it("leaves every other row exactly as it is", () => {
    const calls = ["calls", "outreach"].map(page);
    expect(splitTabs("v6-calls", calls, "calls")).toEqual({ shown: calls, more: [] });
    expect(splitTabs(null, calls, "calls").shown).toEqual(calls);
  });
});
