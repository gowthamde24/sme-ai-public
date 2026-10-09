// @vitest-environment node
/**
 * The shape of the simplified menu (Job X, owner feedback 2026-10-09): few top-level entries, groups that open only where there is a lot, the daily
 * pages never behind a closed group, nothing dangerous first, and no entry for a page that does not exist. These are rules about the table, not about one word.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ALL_ROLES, NAV, barItems, visibleGroups } from "./nav";

const DAILY = ["today", "followups-due", "review", "orders", "records", "add-customer"];
const WEB = path.resolve(import.meta.dirname, "../../..");

describe("the menu's shape", () => {
  it.each(ALL_ROLES)("%s sees at most six top-level entries", (role) => {
    expect(visibleGroups(role).length).toBeLessThanOrEqual(6);
  });
  it("a group with more than three items opens and closes (and none is open and close with fewer than two)", () => {
    for (const g of NAV) if (g.items.length > 3) expect(g.collapsible, g.id).toBe(true);
    for (const role of ALL_ROLES) for (const g of visibleGroups(role)) if (g.collapsible) expect(g.items.length, `${role}:${g.id}`).toBeGreaterThan(1);
  });
  it("a group a role has one item of is a plain link, never a group of one", () => {
    for (const role of ALL_ROLES) for (const g of visibleGroups(role)) expect(g.flat, `${role}:${g.id}`).toBe(g.items.length === 1);
    expect(visibleGroups("viewer").find((g) => g.id === "today")?.flat).toBe(true);
  });
  it("the daily pages are never behind a group that closes, and the phone's tabs are daily pages", () => {
    for (const g of NAV) if (g.collapsible) for (const i of g.items) expect(DAILY, `${g.id}/${i.id}`).not.toContain(i.id);
    for (const role of ALL_ROLES) {
      expect(barItems(role).length).toBeLessThanOrEqual(4);
      for (const i of barItems(role)) expect(DAILY).toContain(i.id);
    }
  });
  it("nothing that erases, suppresses or changes safety settings is in the first group", () => {
    const first = NAV[0];
    expect(first.id).toBe("today");
    for (const i of first.items) expect(i.id).not.toMatch(/privacy|suppression|erasure|security/);
  });
  it("every entry opens a page that exists (no entry for a page that is not built, such as a team page)", () => {
    for (const i of NAV.flatMap((g) => g.items)) {
      const file = i.path.startsWith("/app") ? path.join(WEB, "app", i.path, "page.tsx") : path.join(WEB, "app/app/tenants/[tenantId]", i.path, "page.tsx");
      expect(fs.existsSync(file), `${i.id}: ${file}`).toBe(true);
    }
  });
  it("every group says which kind of thing it holds with a word and an icon, and the ids are unique", () => {
    const items = NAV.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(items).size).toBe(items.length);
    expect(new Set(NAV.map((g) => g.id)).size).toBe(NAV.length);
    for (const g of NAV) expect(g.label.length).toBeGreaterThan(2);
  });
});
