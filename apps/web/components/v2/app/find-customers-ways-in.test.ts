import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";

import { paletteNames } from "./palette/names";
import { matchItems } from "./palette/palette";
import { shortcutsOf } from "./TabBar";

describe("the ways in to Find customers and Lead sources (owner, 18 Nov 2026)", () => {
  it("the phone More sheet offers Find customers where the Lead Finder is here (Owner, Admin, Sales) and Lead sources to Owner and Admin", () => {
    expect(shortcutsOf("owner", ["lead_finder"]).map((s) => s.id)).toEqual(["retailers", "lead-sources"]);
    expect(shortcutsOf("admin", ["lead_finder"]).map((s) => s.path)).toEqual(["/retailers", "/lead-sources"]);
    expect(shortcutsOf("sales", ["lead_finder"]).map((s) => s.id)).toEqual(["retailers"]);
    expect(shortcutsOf("viewer", ["lead_finder"])).toEqual([]);
    expect(shortcutsOf("owner", []).map((s) => s.id)).toEqual(["lead-sources"]); // a business type or Viewer without the Lead Finder: no Find customers
  });
  it("the words are there in every language", () => {
    for (const l of ["en", "te", "hi", "kn"] as const) {
      const d = appDict(l) as Record<string, string>;
      expect(d["nav.item.retailers"]).toBeTruthy();
      expect(d["nav.item.lead-sources"]).toBeTruthy();
    }
    expect((appDict("en") as Record<string, string>)["nav.finder.customers"]).toBe("Find customers");
  });
  it("the command palette finds it by 'find', 'lead finder', 'find customers' and 'new customers' (the page and the action)", () => {
    const { names } = paletteNames("en");
    const page = { id: "m-find", kind: "page" as const, label: names["m-find"][0], names: names["m-find"], href: "/retailers" };
    const act = { id: "action:find", kind: "action" as const, label: names["action:find"][0], names: names["action:find"], href: "/retailers" };
    const found = (q: string) => [...matchItems(q, [page]), ...matchItems(q, [act])].map((i) => i.id);
    for (const q of ["find", "lead finder", "find customers", "new customers"]) expect(found(q).length, q).toBeGreaterThan(0);
  });
});
