import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { visibleGroups } from "@/components/v2/app/nav";

const PACKS = path.resolve(import.meta.dirname, "../../../../packages/packs");
const modules = (id: string): string[] => JSON.parse(fs.readFileSync(path.join(PACKS, id, "pack.json"), "utf8")).modules;

describe("a school has no lead finding (job DM: its work is admission enquiries, fee reminders and progress messages)", () => {
  it("its pack does not switch on the lead finder or the research module, and the other two business types do", () => {
    expect(modules("education")).not.toContain("lead_finder");
    expect(modules("education")).not.toContain("research");
    for (const id of ["textiles", "construction_materials"]) expect(modules(id), id).toEqual(expect.arrayContaining(["lead_finder", "research"]));
  });
  it("so its menu has no 'Find retailers', and a shop's does", () => {
    const items = (id: string) => visibleGroups("owner", { modules: modules(id) } as never).flatMap((g) => g.items.map((i) => i.id));
    expect(items("education")).not.toContain("retailers");
    expect(items("textiles")).toContain("retailers");
  });
  it("its public steps are its own words (admission enquiries first), and they say the marks and fee messages are never written by the AI", () => {
    const landing = JSON.parse(fs.readFileSync(path.join(PACKS, "education/landing.json"), "utf8"));
    expect(landing.steps["1"].title.en).toBe("Admission enquiries");
    expect(landing.steps["1"].text.en).toMatch(/does not search for leads/);
    expect(landing.steps["6"].text.en).toMatch(/never written by the AI/);
    expect(landing.steps["3"].text.en).toMatch(/does not discuss a child's fees or marks/);
  });
});
