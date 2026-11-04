import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { visibleGroups } from "@/components/v2/app/nav";

const PACKS = path.resolve(import.meta.dirname, "../../../../packages/packs");
const modules = (id: string): string[] => JSON.parse(fs.readFileSync(path.join(PACKS, id, "pack.json"), "utf8")).modules;

describe("a school finds organisations, never people (job DM: its work is admission enquiries, fee reminders and progress messages; owner 4 Nov: the Lead Finder for schools, organisations only)", () => {
  it("its pack switches on the lead finder (organisations only, C1 #319) but never the research module; the other two business types have both", () => {
    expect(modules("education")).toContain("lead_finder");
    expect(modules("education")).not.toContain("research");
    for (const id of ["textiles", "construction_materials"]) expect(modules(id), id).toEqual(expect.arrayContaining(["lead_finder", "research"]));
  });
  it("so its menu has the Lead Finder's item (key 'retailers'; the school's label 'Find organisations' is the `@organisations` word of the web, PR #322), like a shop's", () => {
    const items = (id: string) => visibleGroups("owner", { modules: modules(id) } as never).flatMap((g) => g.items.map((i) => i.id));
    expect(items("education")).toContain("retailers");
    expect(items("textiles")).toContain("retailers");
  });
  it("its public steps are its own words (admission enquiries first), and they say the marks and fee messages are never written by the AI", () => {
    const landing = JSON.parse(fs.readFileSync(path.join(PACKS, "education/landing.json"), "utf8"));
    expect(landing.steps["1"].title.en).toBe("Admission enquiries");
    expect(landing.steps["1"].text.en).toMatch(/never families/);
    expect(landing.steps["6"].text.en).toMatch(/never written by the AI/);
    expect(landing.steps["3"].text.en).toMatch(/does not discuss a child's fees or marks/);
  });
});
