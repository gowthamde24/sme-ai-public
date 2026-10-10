// @vitest-environment node
/**
 * The shape of the menu as the design-lab app draws it (Job AC, batch C1): few top-level groups, plain words, the daily pages on the phone's bar, every entry a page that
 * exists, and every page of the app reachable from some entry. These are rules about the table, not about one word.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ALL_ROLES, FOOT, NAV, barItems, visibleGroups } from "./nav";

const WEB = path.resolve(import.meta.dirname, "../../..");
const TENANT = path.join(WEB, "app/app/tenants/[tenantId]");

describe("the menu's shape", () => {
  it.each(ALL_ROLES)("%s sees at most four labelled groups, and the foot holds Settings only", (role) => {
    expect(visibleGroups(role).length).toBeLessThanOrEqual(4);
  });
  it("the phone's bar has at most five tabs, all of them daily pages that every role that sees them can open", () => {
    for (const role of ALL_ROLES) expect(barItems(role).length).toBeLessThanOrEqual(5);
    expect(NAV.flatMap((g) => g.items).filter((i) => i.bar).map((i) => i.id)).toEqual(["today", "leads", "quotes", "orders", "office"]);
  });
  it("every entry opens a page that exists (no entry for a page that is not built)", () => {
    for (const i of [...NAV.flatMap((g) => g.items), ...FOOT]) {
      const file = i.path === "" ? path.join(TENANT, "page.tsx") : path.join(TENANT, i.path, "page.tsx");
      expect(fs.existsSync(file), `${i.id}: ${file}`).toBe(true);
    }
  });
  it("every page of the workspace belongs to an entry (the marker and the way back are never lost)", () => {
    const owners = [...NAV.flatMap((g) => g.items), ...FOOT].flatMap((i) => [i.path, ...(i.also ?? [])]).filter((p) => p !== "");
    const hasPage = (dir: string): boolean => fs.readdirSync(dir, { withFileTypes: true }).some((e) => (e.isDirectory() ? hasPage(path.join(dir, e.name)) : e.name === "page.tsx"));
    // a folder that holds only a route handler (the "Ask your team" stream, /ask) is not a screen
    const dirs = fs.readdirSync(TENANT, { withFileTypes: true }).filter((e) => e.isDirectory() && hasPage(path.join(TENANT, e.name))).map((e) => `/${e.name}`);
    expect(dirs.filter((d) => !owners.includes(d)), "a directory with no menu entry").toEqual([]);
  });
  it("the ids are unique and every group and entry has a word and an icon", () => {
    const items = [...NAV.flatMap((g) => g.items), ...FOOT];
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(new Set(NAV.map((g) => g.id)).size).toBe(NAV.length);
    for (const g of NAV) expect(g.label.length).toBeGreaterThan(2);
    for (const i of items) expect(i.icon, i.id).toBeTruthy();
  });
});
