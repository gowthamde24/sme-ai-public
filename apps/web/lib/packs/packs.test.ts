// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";
import { NAV, barItems, coreItem, footItems, visibleGroups, type PackFrame, type Role } from "@/components/v2/app/nav";

import { allModules, defaultPackId, otherPackIds, PACKS_DIR, packFiles, workspacePack } from "./pack-test-kit";
import { packFrame, packWords, withPackT, withPackWords } from "./resolve";

const WEB = path.resolve(import.meta.dirname, "..", "..");
const ROLES: Role[] = ["owner", "admin", "sales", "viewer"];
const dict = app as unknown as Record<string, Record<string, string>>;
const ids = (f: PackFrame | null, role: Role = "owner") => visibleGroups(role, f).flatMap((g) => g.items.map((i) => i.id));

describe("the web reads the business types from packages/packs through the API's shapes (one source of truth)", () => {
  it("every module the menu names is a module of the closed list in packages/packs/modules.json", () => {
    const modules = allModules();
    for (const i of [...NAV.flatMap((g) => g.items), ...footItems("owner")]) if (i.module) expect(modules, i.id).toContain(i.module);
  });
  it("every core tab a pack names has a menu item that holds it (or the default tab stays)", () => {
    for (const p of Object.values(packFiles())) expect(coreItem(packFrame(workspacePack(p.id), "en"))?.id, p.id).toBeTruthy();
  });
  it("a word a pack changes is one the app dictionary already has, or one of the pack's own kinds (word.*, pack.*)", () => {
    for (const p of Object.values(packFiles())) for (const key of Object.keys(p.labels.en)) expect(key.startsWith("word.") || key.startsWith("pack.") || key in dict, `${p.id}:${key}`).toBe(true);
  });
  it("the default pack says in every language exactly the words the app dictionary already says for the same keys (textiles must look as today)", () => {
    const base = packFiles()[defaultPackId()];
    for (const lang of ["en", "te", "hi", "kn"]) {
      for (const [key, text] of Object.entries(base.labels[lang] ?? {})) if (key in dict && !key.startsWith("word.") && !key.startsWith("pack.")) expect(text, `${lang}:${key}`).toBe(dict[key][lang]);
    }
  });
});

describe("the default pack is the product as it was (equivalence: textiles must look exactly as today)", () => {
  const pack = workspacePack(defaultPackId(), "legacy");
  const frame = packFrame(pack, "en");
  it("changes no word of the app dictionary and is not badged", () => {
    expect(frame.validated).toBe(true);
    for (const lang of ["en", "te", "hi", "kn"]) {
      const words = Object.fromEntries(Object.entries(dict).map(([k, v]) => [k, v[lang]]));
      const out = withPackWords(words, pack, lang);
      expect(Object.keys(out).filter((k) => out[k] !== words[k]), lang).toEqual([]);
    }
    const t = ((k: string) => dict[k]?.en ?? k) as never;
    const wrapped = withPackT(t, pack, "en") as unknown as (k: string) => string;
    expect(wrapped("nav.item.today")).toBe("Today");
  });
  it.each(ROLES)("offers a %s the same menu, in the same order, with and without the pack", (role) => {
    const shape = (f: PackFrame | null) => visibleGroups(role, f).map((g) => [g.id, g.items.map((i) => i.id)]);
    expect(shape(frame)).toEqual(shape(null));
    expect(barItems(role, frame).map((i) => i.id)).toEqual(barItems(role, null).map((i) => i.id));
  });
  it("keeps the phone's five tabs: Today, Leads, Quotes, Visits, Office", () => {
    expect(barItems("owner", frame).map((i) => i.id)).toEqual(["today", "leads", "quotes", "visits", "office"]);
  });
  it("hides the items only a pack brings (Fees, Campaigns)", () => {
    expect(ids(frame)).not.toContain("fees");
    expect(ids(frame)).not.toContain("campaigns");
    expect(ids(null)).not.toContain("fees");
  });
});

describe("every pack file, whatever it is (blueprint 13: a new business type is mostly data; `make new-pack` starts one)", () => {
  const all = Object.values(packFiles());
  it.each(all.map((p) => [p.id]))("%s: draws a menu, a phone bar and a sign-up card in all four languages without a crash, with English where a text is missing", (id) => {
    const pack = workspacePack(id, "signup");
    for (const lang of ["en", "te", "hi", "kn", "ta"]) {
      const frame = packFrame(pack, lang);
      for (const role of ROLES) {
        expect(ids(frame, role).length).toBeGreaterThan(0);
        expect(barItems(role, frame).length).toBeLessThanOrEqual(5);
      }
      for (const text of Object.values(frame.labels)) expect(text.length).toBeGreaterThan(0);
      expect(frame.name.length).toBeGreaterThan(0);
    }
  });
  it("flags a language that is only partly translated: a pack may not call a language native-reviewed while it misses keys English has", () => {
    for (const p of all) for (const lang of ["te", "hi", "kn"]) {
      const missing = Object.keys(p.labels.en).filter((k) => !(k in (p.labels[lang] ?? {})));
      const review = (p.language_review as Record<string, string>)[lang];
      if (missing.length > 0) expect(review, `${p.id}:${lang} misses ${missing.join(", ")}`).not.toBe("native_reviewed");
    }
  });
  it("a pack changes words and switches modules only: its labels name no key outside the closed list, so no screen gets text a pack invented", () => {
    const closed = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, "labels.json"), "utf8")).labels.map((l: { key: string }) => l.key);
    for (const p of all) for (const lang of Object.keys(p.labels)) for (const key of Object.keys(p.labels[lang])) expect(closed, `${p.id}:${lang}:${key}`).toContain(key);
  });
});

describe("the other business types", () => {
  for (const id of otherPackIds()) {
    const m = packFiles()[id];
    describe(`${m.id}`, () => {
      const pack = workspacePack(id, "signup");
      const frame = packFrame(pack, "en");
      it("shows exactly the menu its modules allow (default deny), and nothing of a module that is off", () => {
        const shown = new Set(ids(frame));
        for (const i of NAV.flatMap((g) => g.items)) if (i.module && !m.modules.includes(i.module) && i.roles.includes("owner")) expect(shown.has(i.id), i.id).toBe(false);
        for (const i of NAV.flatMap((g) => g.items)) if ((!i.module || m.modules.includes(i.module)) && i.roles.includes("owner")) expect(shown.has(i.id), i.id).toBe(true);
      });
      it("puts its core tab on the phone's bar in the core slot and calls it by the pack's own word", () => {
        const core = coreItem(frame);
        expect(barItems("owner", frame).map((i) => i.id)).toContain(core!.id);
        expect(frame.labels["pack.core_tab"]).toBe(m.labels.en["pack.core_tab"]);
        expect(barItems("owner", frame)).toHaveLength(5);
      });
      it("speaks the person's language, English when a text is missing", () => {
        expect(packFrame(pack, "te").name).toBe((m.names as Record<string, string>).te);
        expect(packFrame(pack, "ta").name).toBe((m.names as Record<string, string>).en);
        expect(packWords(pack, "ta")["nav.item.today"]).toBe(m.labels.en["nav.item.today"]);
      });
    });
  }
  it("a role that may not open an item does not get its tab, whatever the pack says", () => {
    for (const id of otherPackIds()) expect(barItems("viewer", packFrame(workspacePack(id), "en")).map((i) => i.id)).toEqual(["today", "leads", "visits", "office"].filter((x) => ids(packFrame(workspacePack(id), "en"), "viewer").includes(x)));
  });
  it("overlays words on a page only for keys the page already has", () => {
    const pack = workspacePack(otherPackIds()[0]);
    const own = packWords(pack, "en");
    const key = Object.keys(own).find((k) => k.startsWith("agent.") && own[k] !== dict[k]?.en)!;
    expect(withPackWords({ [key]: "x", "other.key": "y" }, pack, "en")).toEqual({ [key]: own[key], "other.key": "y" });
    expect(Object.keys(withPackWords({ "other.key": "x" }, pack, "en"))).toEqual(["other.key"]);
    const t = withPackT(((k: string, v?: unknown) => (v ? `${k}!` : k)) as never, pack, "en") as unknown as (k: string, v?: unknown) => string;
    expect(t(key)).toBe(own[key]);
    expect(t(key, { n: 1 })).toBe(`${key}!`);
    expect(t("agent.nope")).toBe("agent.nope");
  });
});

describe("the web never holds a copy of the packs, and the files are read by server code only", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (["node_modules", ".next", "test"].includes(e.name) ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
  const source = ["app", "components", "lib", "i18n"].flatMap((d) => walk(path.join(WEB, d))).filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.|test-kit\.|fixtures?\.(ts|mjs)$|-fixtures\./.test(f));
  it("has no generated bundle and no registry of the pack files inside apps/web", () => {
    expect(fs.existsSync(path.join(WEB, "lib", "packs", "packs.generated.json"))).toBe(false);
    expect(fs.existsSync(path.join(WEB, "lib", "packs", "registry.ts"))).toBe(false);
    // nothing imports or reads a pack file (a comment may say where they live)
    expect(source.filter((f) => /(from\s+|import\(|require\(|readFile\w*\(|join\()[^;\n]*["'`][^"'`]*packages\/packs/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(WEB, f))).toEqual([]);
  });
  it("is used by no client component (the server turns what a screen needs into plain props)", () => {
    const clients = source.filter((f) => /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8")));
    for (const f of clients) expect(fs.readFileSync(f, "utf8"), path.relative(WEB, f)).not.toMatch(/@\/lib\/packs\/(resolve|signup|read|activation|activation-facts)|@\/lib\/api\/pack"/);
  });
});
