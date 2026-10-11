import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";

import { catalogueWords } from "./catalogue-words";
import { WHY_REASONS } from "./catalogue-actions-words";

const ROOT = path.join(import.meta.dirname, "../../../../..");
const FILES = [
  ...fs.readdirSync(path.join(ROOT, "components/v2/app/catalogue")).filter((f) => /\.(tsx?|ts)$/.test(f) && !f.includes(".test.") && !f.includes("test-kit")).map((f) => path.join(ROOT, "components/v2/app/catalogue", f)),
  ...fs.readdirSync(import.meta.dirname).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test.")).map((f) => path.join(import.meta.dirname, f)),
  path.join(ROOT, "app/app/tenants/[tenantId]/catalogue/[itemId]/page.tsx"),
  path.join(ROOT, "app/app/tenants/[tenantId]/catalogue/[itemId]/edit/page.tsx"),
  path.join(ROOT, "app/app/tenants/[tenantId]/catalogue/new/page.tsx"),
];

describe("the catalogue's words", () => {
  it("every word key written out in the catalogue's sources exists in the string store, in all four languages", () => {
    const keys = new Set<string>();
    for (const f of FILES) for (const m of fs.readFileSync(f, "utf8").matchAll(/"((?:catalogue|contact|today|nav|frame|outbox)\.[a-z0-9_.]+)"/g)) if (!m[1].endsWith(".")) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(80);
    for (const lang of ["en", "te", "hi", "kn"] as const) {
      const dict = appDict(lang) as Record<string, string>;
      for (const k of keys) if (!dict[k]) throw new Error(`${k} is missing in ${lang}`);
    }
  });

  it("every word the client parts need is handed down by the server", () => {
    const words = catalogueWords("en");
    for (const k of ["catalogue.add", "catalogue.photo.take", "catalogue.send.go", "today.err.mfa", "today.err.mfa.link", "today.lang.te", "today.act.working", "contact.keep", "contact.state.sent", "frame.notyet", "nav.item.sarees", "catalogue.fabric.kanchi_pattu", "catalogue.colour.maroon"]) expect(words[k], k).toBeTruthy();
    expect(Object.keys(words).length).toBeGreaterThan(150);
  });

  it("a language other than English gets its own words for the screens' labels, and English for money and what was sent", () => {
    const en = catalogueWords("en");
    const te = catalogueWords("te");
    expect(te["catalogue.add"]).not.toBe(en["catalogue.add"]);
    expect(te["catalogue.photo.take"]).not.toBe(en["catalogue.photo.take"]);
    for (const k of ["catalogue.filter.band", "catalogue.field.price", "catalogue.err.price", "catalogue.send.why", "catalogue.why.money", "catalogue.send.template", "catalogue.send.preview.note", "catalogue.record.on", "catalogue.send.intro"]) expect(te[k], k).toBe(en[k]);
  });

  it("has a plain-words reason for every reason a message can wait for approval", () => {
    const dict = appDict("en") as Record<string, string>;
    for (const r of [...WHY_REASONS, "other"]) expect(dict[`catalogue.why.${r}`], r).toBeTruthy();
  });
});
