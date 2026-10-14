// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";
import { FOOT, NAV, barItems, footItems, visibleGroups, type Role } from "@/components/v2/app/nav";
import { buildBundle, checkAll, packIds, PACKS_DIR, readAll, readSchema, validate } from "../../../../packages/packs/validate.mjs";

import { PACKS, defaultPack, isKnownPack, MODULES, packById, signupPacks, textIn } from "./registry";
import { packFrame, packWords, withPackT, withPackWords } from "./resolve";

const WEB = path.resolve(import.meta.dirname, "..", "..");
const MENU = NAV.flatMap((g) => g.items.map((i) => i.id));
const schema = readSchema();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ROLES: Role[] = ["owner", "admin", "sales", "viewer"];

describe("the validator", () => {
  const s = { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string", pattern: "^x", maxLength: 3 }, b: { enum: [1, 2] }, c: { type: "array", items: { type: "integer" }, maxItems: 2, uniqueItems: true } } };
  it("accepts a good value and names each fault with its path", () => {
    expect(validate({ a: "xy", b: 1, c: [1, 2] }, s)).toEqual([]);
    expect(validate({ b: 3, z: 1, c: [1, 1, 2, "q"] }, s).join("\n")).toMatch(/"a" is required[\s\S]*not one of 1, 2[\s\S]*"z" is not allowed[\s\S]*more than 2 items[\s\S]*not unique[\s\S]*c\[3\]: expected integer/);
    expect(validate({ a: "abcd" }, s).join("\n")).toMatch(/longer than 3[\s\S]*does not match/);
  });
  it("refuses a schema keyword it does not know, instead of half-checking", () => {
    expect(validate({}, { type: "object", oneOf: [] } as never)[0]).toMatch(/does not know the schema keyword "oneOf"/);
  });
  it("resolves $ref into $defs and reports one it cannot", () => {
    expect(validate("q", { $defs: { t: { type: "string", minLength: 2 } }, $ref: "#/$defs/t" })).toEqual(["$: shorter than 2"]);
    expect(validate("q", { $ref: "#/$defs/nope" })[0]).toMatch(/cannot resolve/);
  });
});

describe("the pack files (CI check, blueprint section 13)", () => {
  const packs = readAll() as Record<string, never>;
  it("are in packages/packs, one folder each, and there are three business types", () => {
    expect(packIds()).toEqual(["construction", "education", "textiles"]);
    expect(PACKS.map((p) => p.id)).toEqual(["textiles", "construction", "education"]); // sign-up order
  });
  it("all pass the JSON Schema and the cross-file rules", () => {
    expect(checkAll(packs, schema, MENU)).toEqual([]);
  });
  it("say every text in English, Telugu, Hindi and Kannada", () => {
    for (const p of PACKS) {
      const texts = [p.name, p.tagline, p.business_name_default, ...Object.values(p.labels), ...p.fields.flatMap((f) => [f.label, ...(f.choices ?? []).map((c) => c.label)]), ...p.activation.steps.flatMap((x) => [x.title, x.hint])];
      for (const t of texts) for (const l of ["en", "te", "hi", "kn"] as const) expect(t[l]?.trim().length, `${p.id}:${t.en}:${l}`).toBeGreaterThan(0);
      for (const [lang, script] of [["te", /[ఀ-౿]/], ["hi", /[ऀ-ॿ]/], ["kn", /[ಀ-೿]/]] as const) expect(texts.filter((t) => !script.test(t[lang]) && !/^[\d\s%()]+$/.test(t.en) && !/^\d+$/.test(t.en)).map((t) => t.en), `${p.id}:${lang} not in its own script`).toEqual([]);
    }
  });
  it("change only words that exist in the app dictionary (a pack changes words, it does not add text)", () => {
    for (const p of PACKS) for (const k of Object.keys(p.labels)) expect(Object.keys(app), `${p.id}:${k}`).toContain(k);
  });
  it("name only modules and menu items that exist", () => {
    for (const p of PACKS) {
      for (const m of p.modules) expect(MODULES, `${p.id}:${m}`).toContain(m);
      for (const b of p.nav.bar) expect(MENU, `${p.id}:${b}`).toContain(b);
    }
    for (const i of [...NAV.flatMap((g) => g.items), ...FOOT]) if (i.module) expect(MODULES, i.id).toContain(i.module);
  });
  it("have exactly one default, and a sign-up card each", () => {
    expect(PACKS.filter((p) => p.default)).toHaveLength(1);
    expect(defaultPack().id).toBe(PACKS[0].id);
    expect(signupPacks()).toHaveLength(3);
    expect(isKnownPack(PACKS[1].id)).toBe(true);
    expect(isKnownPack("nope")).toBe(false);
    expect(packById("nope").default).toBe(true); // an id this build does not know is drawn with the default pack, never a crash
    expect(packById(undefined).default).toBe(true);
  });
  it("keep personal and child data out of the fields a model could see: child fields do not exist on contacts or items of any pack yet, and personal ones are marked", () => {
    expect(PACKS.flatMap((p) => p.fields).filter((f) => f.pii_class === "child")).toEqual([]);
    expect(PACKS.flatMap((p) => p.fields).filter((f) => f.pii_class === "personal").map((f) => f.code)).toEqual(["relation"]);
  });
  it("the generated bundle the web app imports is fresh (run `make packs`)", () => {
    const want = `${JSON.stringify(buildBundle(readAll(), schema), null, 1)}\n`;
    expect(fs.readFileSync(path.join(WEB, "lib", "packs", "packs.generated.json"), "utf8")).toBe(want);
  });
  it("a fault in a pack is caught", () => {
    const bad = clone(packs);
    delete (bad.construction as { name: { te?: string } }).name.te;
    (bad.education as { modules: string[] }).modules.push("nonsense");
    (bad.textiles as { nav: { bar: string[] } }).nav.bar.push("nope");
    (bad.education as { default: boolean }).default = true;
    (bad.construction as { labels: Record<string, unknown> }).labels["settings.title"] = { en: "x", te: "x", hi: "x", kn: "x" };
    const errors = checkAll(bad, schema, MENU).join("\n");
    expect(errors).toMatch(/construction: \$\.name: "te" is required/);
    expect(errors).toMatch(/education: \$\.modules\[\d+\]: "nonsense" is not one of/);
    expect(errors).toMatch(/textiles: nav.bar "nope" is not a menu item/);
    expect(errors).toMatch(/exactly one pack must have "default": true/);
    expect(errors).toMatch(/construction: \$\.labels: "settings.title" is not allowed here/);
  });
  it("cross-file rules: choices belong to choice fields, codes are unique, a contact field needs the contacts module", () => {
    const bad = clone(packs) as Record<string, { fields: { entity: string; code: string; kind: string; label: unknown; pii_class: string; choices?: unknown }[]; modules: string[] }>;
    bad.construction.fields.push({ entity: "contact", code: "customer_type", kind: "text", label: bad.construction.fields[0].label, pii_class: "none", choices: [{}, {}] });
    bad.education.modules = bad.education.modules.filter((m: string) => m !== "contacts");
    const errors = checkAll(bad as never, schema, MENU).join("\n");
    expect(errors).toMatch(/field contact.customer_type is defined twice/);
    expect(errors).toMatch(/"choices" belong to choice and multi_choice fields only/);
    expect(errors).toMatch(/education: field contact\.relation: a contact field needs the "contacts" module/);
  });
});

describe("the default pack is the product as it was (equivalence: textiles must look exactly as today)", () => {
  const base = defaultPack();
  const frame = packFrame(base, base.modules, "en");
  it("changes no word and is not badged", () => {
    expect(frame.labels).toEqual({});
    expect(frame.isDefault).toBe(true);
    expect(packWords(base, "en")).toEqual({});
    const words = { "nav.item.orders": "Orders" };
    expect(withPackWords(words, base, "te")).toBe(words);
    const t = (k: string) => k;
    expect(withPackT(t as never, base, "en")).toBe(t);
  });
  it.each(ROLES)("offers a %s the same menu, in the same order, with and without the pack", (role) => {
    const ids = (g: ReturnType<typeof visibleGroups>) => g.map((x) => [x.id, x.items.map((i) => i.id)]);
    expect(ids(visibleGroups(role, frame))).toEqual(ids(visibleGroups(role)));
    expect(barItems(role, frame).map((i) => i.id)).toEqual(barItems(role).map((i) => i.id));
    expect(footItems(role).length).toBeLessThanOrEqual(1);
  });
  it("keeps the phone's five tabs: Today, Leads, Quotes, Visits, Office", () => {
    expect(barItems("owner", frame).map((i) => i.id)).toEqual(["today", "leads", "quotes", "visits", "office"]);
  });
  it("hides the items only a pack brings (Fees, Campaigns)", () => {
    const all = visibleGroups("owner", frame).flatMap((g) => g.items.map((i) => i.id));
    expect(all).not.toContain("fees");
    expect(all).not.toContain("campaigns");
    expect(visibleGroups("owner").flatMap((g) => g.items.map((i) => i.id))).not.toContain("fees");
  });
});

describe("the other business types", () => {
  const frameOf = (index: number, lang = "en") => packFrame(PACKS[index], PACKS[index].modules, lang);
  const idsOf = (f: ReturnType<typeof frameOf>, role: Role = "owner") => visibleGroups(role, f).flatMap((g) => g.items.map((i) => i.id));
  it("construction: Orders & deliveries is the core tab; Quotes, Catalogue and the finder stay; the words are its own", () => {
    const f = frameOf(1);
    expect(barItems("owner", f).map((i) => i.id)).toEqual(["today", "chats", "orders", "customers"]);
    expect(f.labels["nav.item.orders"]).toBe("Orders & deliveries");
    expect(f.labels["nav.item.customers"]).toBe("Customers & sites");
    expect(f.labels["nav.item.visits"]).toBe("Site visits");
    expect(idsOf(f)).toEqual(expect.arrayContaining(["quotes", "orders", "sarees", "retailers", "campaigns"]));
    expect(idsOf(f)).not.toContain("fees");
    expect(packWords(PACKS[1], "en")["agent.requirement_analyst"]).toBe("Site Measurer");
  });
  it("education: Fees is the core tab; no Quotes, Orders, Catalogue or finder; Campaigns and Fees are there", () => {
    const f = frameOf(2);
    expect(barItems("owner", f).map((i) => i.id)).toEqual(["today", "chats", "fees", "customers"]);
    expect(idsOf(f)).toEqual(expect.arrayContaining(["fees", "campaigns", "customers", "visits", "chats"]));
    for (const gone of ["quotes", "orders", "sarees", "catalogue", "retailers"]) expect(idsOf(f), gone).not.toContain(gone);
    expect(f.labels["nav.item.customers"]).toBe("Parents & students");
    expect(f.labels["nav.item.visits"]).toBe("Campus visits");
    expect(packWords(PACKS[2], "en")["agent.quote_writer"]).toBe("Fee Desk");
  });
  it("a role that may not open an item does not get its tab, whatever the pack says", () => {
    expect(barItems("viewer", frameOf(1)).map((i) => i.id)).toEqual(["today", "customers"]);
    expect(barItems("sales", frameOf(2)).map((i) => i.id)).toEqual(["today", "chats", "fees", "customers"]);
  });
  it("speaks the person's language, English when a text is missing", () => {
    expect(frameOf(1, "hi").labels["nav.item.orders"]).toBe("ऑर्डर और डिलीवरी");
    expect(textIn(PACKS[1].name, "ta")).toBe("Construction materials");
    expect(frameOf(1, "te").name).toBe("నిర్మాణ సామగ్రి");
  });
  it("overlays words on a page only for keys the page already has", () => {
    const words = { "agent.order_desk": "Order Desk", "agent.lead_finder": "Lead Finder" };
    expect(withPackWords(words, PACKS[1], "en")).toEqual({ "agent.order_desk": "Dispatch Desk", "agent.lead_finder": "Lead Finder" });
    expect(Object.keys(withPackWords({ "other.key": "x" }, PACKS[1], "en"))).toEqual(["other.key"]);
    const t = withPackT(((k: string, v?: unknown) => (v ? `${k}!` : k)) as never, PACKS[1], "en") as unknown as (k: string, v?: unknown) => string;
    expect(t("agent.order_desk")).toBe("Dispatch Desk");
    expect(t("agent.order_desk", { n: 1 })).toBe("agent.order_desk!");
    expect(t("agent.researcher")).toBe("agent.researcher");
  });
});

describe("no pack id in code, and the registry stays on the server", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (["node_modules", ".next", "test"].includes(e.name) ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
  const source = ["app", "components", "lib", "i18n"].flatMap((d) => walk(path.join(WEB, d))).filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.|-test-kit\.|fixtures?\.(ts|mjs)$|-fixtures\./.test(f));
  it("finds source files to look at", () => {
    expect(source.length).toBeGreaterThan(300);
  });
  it("names no business type in any application source file (the ids are the folders of packages/packs)", () => {
    const ids = fs.readdirSync(PACKS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    const re = new RegExp(`["'\`](${ids.join("|")})["'\`]`);
    expect(source.filter((f) => re.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(WEB, f))).toEqual([]);
  });
  it("is imported by no client component (it holds all four languages of every pack)", () => {
    const clients = source.filter((f) => /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8")));
    for (const f of clients) expect(fs.readFileSync(f, "utf8"), path.relative(WEB, f)).not.toMatch(/@\/lib\/packs\/(registry|packs\.generated|resolve|signup|read|activation)|@\/lib\/api\/pack"/);
  });
});
