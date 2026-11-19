import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";
import { WHO_LANGUAGES, WHO_NUMBERS, WHO_TONES, WHO_VOICES } from "@/lib/jobs/who";

import { CATEGORIES, CHECK_CODES, FIX_CODES, DRAFT_LANGS, runChecks, type Message } from "./meta-checks";
import { REJECTION_CODES } from "./types";

const dict = app as Record<string, { en: string; te: string; hi: string; kn: string }>;
const has = (key: string): boolean => key in dict && Boolean(dict[key].en && dict[key].te && dict[key].hi && dict[key].kn);

/** Every closed word of the builder and of Who talks has its sentence in all four languages (a code with no words would draw a raw key on a person's screen). */
describe("the builder and Who talks have words for every closed code (en, te, hi, kn)", () => {
  it("check titles and fixes, group names, rejection reasons, parts and languages", () => {
    const missing = [
      ...CHECK_CODES.map((c) => `jobs.tb.check.${c}.title`),
      ...FIX_CODES.map((c) => `jobs.tb.fix.${c}`),
      ...CATEGORIES.map((c) => `jobs.tb.cat.${c}`),
      ...REJECTION_CODES.map((c) => `jobs.tb.why.${c}`),
      "jobs.tb.why.price_or_offer_plain",
      ...DRAFT_LANGS.map((l) => `jobs.tb.lang.${l}`),
      ...["header", "body", "footer", "buttons"].map((p) => `jobs.tb.part.${p}`),
      ...["waiting", "approved", "needs_change"].map((s) => `jobs.tb.status.${s}`),
      ...WHO_LANGUAGES.map((l) => `jobs.opt.language.${l}`),
      ...WHO_TONES.flatMap((c) => [`jobs.who.tone.${c}`, `jobs.who.tone.ex.${c}`]),
      ...WHO_VOICES.flatMap((c) => [`jobs.who.voice.${c}`, `jobs.who.voice.${c}.d`]),
      ...WHO_NUMBERS.map((c) => `jobs.who.number.${c}`),
    ].filter((k) => !has(k));
    expect(missing).toEqual([]);
  });
  it("every sentence a check can give (ok or warn, every variant) exists", () => {
    const base = { header: null, footer: null, buttons: [] as string[] };
    const samples: Message[] = [
      { category: "utility", drafts: { te: { ...base, body: "{name} ఆఫర్ 🎉🎉🎉🎉" }, en: { ...base, body: "{name} READY new collection 20% off 🎉🎉🎉🎉", footer: "f".repeat(70), buttons: ["a", "b", "c", "d"] } } },
      { category: "utility", drafts: { te: { ...base, body: "ok {name}" }, en: { ...base, body: "Hi {name} 🙏", buttons: ["a".repeat(30)] } } },
      { category: "utility", drafts: { te: { ...base, body: "x" }, en: { ...base, body: "Bye {name}" } } },
      { category: "marketing", drafts: { te: { ...base, body: "హలో {name} గారు, ఆఫర్" }, en: { ...base, body: "" } } },
      { category: "utility", drafts: { te: { ...base, body: "నమస్కారం {name} గారు" }, en: { ...base, body: "Hello {name}, your order." } } },
    ];
    const keys = new Set(samples.flatMap((m) => runChecks(m).map((r) => r.key)));
    // the variants the samples cannot all reach are asserted from the code list in meta-checks.test.ts; here: every key found has words
    expect([...keys].filter((k) => !has(k))).toEqual([]);
    expect(keys.size).toBeGreaterThan(12);
  });
  it("every jobs.tb.* and jobs.who.* key a screen names exists", () => {
    const names = new Set<string>();
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
    for (const f of [...walk(path.join(process.cwd(), "components/v2/app/whatsapp/builder")), ...walk(path.join(process.cwd(), "components/v2/app/jobs/detail"))].filter((x) => /\.tsx$/.test(x) && !/\.test\./.test(x))) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/["'`](jobs\.(?:tb|who)\.[a-z0-9_.]+)["'`]/g)) names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(40);
    expect([...names].filter((k) => !has(k))).toEqual([]);
  });
});
