import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { csvLine, parseCsv } from "./i18n-data.mjs";
import { KIT_HEADER, KIT_LANGS, LEGAL_DOCS, TOP_APP_STRINGS, applyPlan, buildRows, flattenLegal, loadSources, noteHtml, planImport, rankAppStrings, readLegalFile, sheetCsv, sheetHtml } from "./review-kit.mjs";

type Row = { group: string; key: string; en: string; current: string; where: string; ref: { kind: string; set?: string; key?: string; doc?: string; id?: string } };
const WEB = path.resolve(import.meta.dirname, "../..");
type Src = { root: string; sets: Record<string, Record<string, { en: string; te: string; hi: string; kn: string; humanOnly?: boolean }>>; legal: Record<string, Record<string, { file: string; src: string; flat: { id: string; text: string }[] }>> };
const src = loadSources() as unknown as Src;
const rowsOf = (lang: string): Row[] => buildRows(lang, src);

/** A filled sheet: the exported one with the given rows' "corrected" / "comment" cells written. */
function filled(lang: string, fixes: Record<string, { corrected?: string; comment?: string; draft?: string }>, { drop = [] as string[] } = {}): string {
  const lines = [csvLine(KIT_HEADER)];
  for (const r of rowsOf(lang)) {
    if (drop.includes(r.key)) continue;
    const f = fixes[r.key] ?? {};
    lines.push(csvLine([r.key, r.en, f.draft ?? r.current, f.corrected ?? "", f.comment ?? "", r.where]));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
const first = (lang: string, pred: (r: Row) => boolean): Row => rowsOf(lang).find(pred)!;
const withTokens = (lang: string) => first(lang, (r) => r.ref.kind === "json" && r.ref.set === "app" && /\{\w+\}/.test(r.en));

describe("the review sheet", () => {
  it.each(KIT_LANGS)("%s: covers the home page and its sample chat, the Privacy Policy, the data-deletion page, sign-up, sign-in and the 200 most-seen app strings", (lang) => {
    const rows = rowsOf(lang);
    const groups = new Set(rows.map((r) => r.group));
    expect([...groups]).toEqual(["Home page", "Privacy Policy", "Data-deletion page", "Sign-up", "Sign-in", "The app: the 200 strings people see most"]);
    expect(rows.filter((r) => r.group.startsWith("The app")).length).toBe(TOP_APP_STRINGS);
    expect(rows.some((r) => r.key.startsWith(`site.langs.sample.${lang}.`))).toBe(true);
    expect(rows.some((r) => r.key.startsWith("site.langs.sample.") && !r.key.startsWith(`site.langs.sample.${lang}.`))).toBe(false); // another language's sample chat is not this reader's
    expect(rows.some((r) => r.key.startsWith("privacy.")) && rows.some((r) => r.key.startsWith("data-deletion."))).toBe(true);
    expect(rows.some((r) => r.key.startsWith("signup.")) && rows.some((r) => r.key.startsWith("login."))).toBe(true);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.current.trim(), r.key).not.toBe("");
      expect(r.where, r.key).not.toBe("");
    }
  });
  it("the three languages carry the same texts, so a reviewer of each reads the same things", () => {
    const keys = (l: string) => rowsOf(l).map((r) => r.key).filter((k) => !k.startsWith("site.langs.sample."));
    expect(keys("hi")).toEqual(keys("te"));
    expect(keys("kn")).toEqual(keys("te"));
  });
  it("is a CSV with the six columns, the two blank ones blank, that reads back to the same rows", () => {
    const rows = rowsOf("te");
    const parsed = parseCsv(sheetCsv(rows));
    expect(parsed[0]).toEqual(KIT_HEADER);
    expect(parsed.length).toBe(rows.length + 1);
    parsed.slice(1).forEach((p, i) => {
      expect(p).toHaveLength(6);
      expect(p[0]).toBe(rows[i].key);
      expect(p[1]).toBe(rows[i].en);
      expect(p[2]).toBe(rows[i].current);
      expect(p[3]).toBe("");
      expect(p[4]).toBe("");
      expect(p[5]).toBe(rows[i].where);
    });
  });
  it("has a printable page that is self-contained, escapes the text and names the language", () => {
    const html = sheetHtml("kn", [{ ...rowsOf("kn")[0], current: "<b>&" }], { date: "2026-10-25" });
    expect(html).toContain("Review sheet: Kannada");
    expect(html).toContain("&lt;b&gt;&amp;");
    expect(html).toContain('lang="kn"');
    expect(html).not.toMatch(/<script|https?:\/\/|<link|<img/);
    expect(html).toContain("@page{size:A4 landscape");
  });
  it("ranks the menu and the top bar first (on every screen), then the strings on the most screens, from the screens' own text", () => {
    const { ranked, total } = rankAppStrings(src.sets.app);
    expect(total).toBeGreaterThan(100);
    expect(ranked[0].key).toMatch(/^(nav|frame)\./);
    const scores = ranked.map((r: { score: number }) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(ranked.slice(0, TOP_APP_STRINGS).every((r: { key: string }) => !src.sets.app[r.key].humanOnly)).toBe(true);
  });
  it("the legal texts of every language have the same shape as the English, and every sentence can be found in its file to be replaced", () => {
    for (const doc of LEGAL_DOCS) {
      const en = src.legal[doc].en.flat.map((x: { id: string }) => x.id);
      for (const lang of KIT_LANGS) {
        const f = src.legal[doc][lang];
        expect(f.flat.map((x: { id: string }) => x.id), `${doc} ${lang}`).toEqual(en);
        for (const x of f.flat) expect(f.src.includes(JSON.stringify(x.text)), `${doc} ${lang} ${x.id}`).toBe(true);
      }
    }
  });
  it("the one-page note says what to do, in a page that prints", () => {
    const md = readFileSync(path.join(WEB, "i18n/review/how-to-review.md"), "utf8");
    expect(md.split("\n").length).toBeLessThan(45);
    for (const w of ["corrected", "curly brackets", "CSV UTF-8", "Privacy Policy"]) expect(md).toContain(w);
    expect(noteHtml(md)).toMatch(/<h1>How to review/);
    expect(noteHtml("a <b>\n- x **y**")).toContain("&lt;b&gt;");
  });
});

describe("importing a filled sheet: checks", () => {
  const check = (lang: string, fixes: Parameters<typeof filled>[1], opts = {}) => planImport(lang, src, filled(lang, fixes), opts);
  it("accepts an untouched sheet: nothing to change", () => {
    const p = planImport("te", src, sheetCsv(rowsOf("te")));
    expect(p.errors).toEqual([]);
    expect(p.edits).toEqual([]);
    expect(p.reviewed).toEqual([]);
  });
  it("takes a correction, a comment, and (only when asked) the untouched rows as reviewed", () => {
    const r = first("hi", (x) => x.key.startsWith("login."));
    const p = check("hi", { [r.key]: { corrected: "नया टेक्स्ट", comment: "ठीक नहीं था" } });
    expect(p.errors).toEqual([]);
    expect(p.edits.map((e: Row) => e.key)).toEqual([r.key]);
    expect(p.comments).toEqual([{ key: r.key, comment: "ठीक नहीं था" }]);
    expect(p.reviewed).toEqual([]);
    expect(check("hi", {}, { markUnchanged: true }).reviewed.length).toBe(rowsOf("hi").length);
  });
  it("refuses a lost, added or changed {token}", () => {
    const r = withTokens("te");
    const tokens = [...r.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    expect(check("te", { [r.key]: { corrected: "టెక్స్ట్" } }).errors.join()).toContain("{tokens}");
    expect(check("te", { [r.key]: { corrected: `${r.current.replace(/\{\w+\}/g, "")} {extra}` } }).errors.join()).toContain("{tokens}");
    expect(check("te", { [r.key]: { corrected: tokens.map((t) => `{${t}x}`).join(" ") } }).errors.join()).toContain("{tokens}");
    expect(check("te", { [r.key]: { corrected: tokens.map((t) => `{${t}}`).join(" ") } }).errors).toEqual([]);
  });
  it("the {tokens} of the legal texts are kept too ({brand}, {privacy_email}, …)", () => {
    const r = first("kn", (x) => x.ref.kind === "legal" && /\{privacy_email\}/.test(x.en));
    expect(check("kn", { [r.key]: { corrected: "ಇಮೇಲ್ ತಪ್ಪು" } }).errors.join()).toContain("{tokens}");
  });
  it("refuses a correction that is only spaces, and a control character", () => {
    const r = rowsOf("te")[3];
    expect(check("te", { [r.key]: { corrected: "   " } }).errors.join()).toContain("only spaces");
    expect(check("te", { [r.key]: { corrected: "ఎ\u0007బి" } }).errors.join()).toContain("control character");
  });
  it("refuses the bookish word of its language and a claim that cannot be proved", () => {
    const r = first("te", (x) => !/\{\w+\}/.test(x.en) && x.ref.kind === "json");
    expect(check("te", { [r.key]: { corrected: "ఈ అభ్యర్థన" } }).errors.join()).toContain("bookish");
    expect(check("hi", { [r.key]: { corrected: "पूरी गारंटी guarantee" } }).errors.join()).toContain("guarantee");
    expect(check("kn", { [r.key]: { corrected: "ಸುರಕ್ಷಿತ 100% ಖಚಿತ" } }).errors.join()).toContain("percentage");
  });
  it("refuses a sheet that is out of date, unless told to take it", () => {
    const r = rowsOf("hi")[5];
    expect(check("hi", { [r.key]: { draft: "something else", corrected: "ठीक" } }).errors.join()).toContain("out of date");
    expect(check("hi", { [r.key]: { draft: "something else", corrected: "ठीक" } }, { allowStale: true }).errors).toEqual([]);
  });
  it("refuses a key of the wrong language, an unknown key, a doubled row and a missing column", () => {
    const te = rowsOf("te")[0];
    const sample = rowsOf("te").find((r) => r.key.startsWith("site.langs.sample.te."))!;
    expect(planImport("hi", src, `${csvLine(KIT_HEADER)}\r\n${csvLine([sample.key, "", "", "x", "", ""])}\r\n`).errors.join()).toContain("is not a text of the Hindi sheet");
    expect(planImport("te", src, `${csvLine(KIT_HEADER)}\r\n${csvLine(["nope.key", "", "", "x", "", ""])}\r\n`).errors.join()).toContain("not a text");
    expect(planImport("te", src, `${csvLine(KIT_HEADER)}\r\n${csvLine([te.key, te.en, te.current, "", "", ""])}\r\n${csvLine([te.key, te.en, te.current, "", "", ""])}\r\n`).errors.join()).toContain("twice");
    expect(planImport("te", src, "key,English\r\nx,y\r\n").errors.join()).toContain('no column "current draft"');
  });
  it("collects every problem, one per row, instead of stopping at the first", () => {
    const [a, b] = rowsOf("te").filter((r) => r.ref.kind === "json" && !/\{\w+\}/.test(r.en));
    const p = check("te", { [a.key]: { corrected: "  " }, [b.key]: { corrected: "అభ్యర్థన" } });
    expect(p.errors.length).toBe(2);
  });
  it("a sentence that is written twice in a legal file takes the same correction in both places, or none", () => {
    const rows = rowsOf("te").filter((r) => r.ref.kind === "legal");
    const dup = rows.find((r) => rows.filter((x) => x.ref.doc === r.ref.doc && x.current === r.current).length > 1);
    if (!dup) return; // the texts of job DQ have no sentence twice in one file; the rule is checked whenever a file has one (the older texts did)
    const twins = rows.filter((x) => x.ref.doc === dup.ref.doc && x.current === dup.current);
    expect(check("te", { [twins[0].key]: { corrected: `${dup.current} ✓` } }).errors.join()).toContain("same correction");
    expect(check("te", Object.fromEntries(twins.map((t) => [t.key, { corrected: `${dup.current} ✓` }]))).errors).toEqual([]);
  });
});

describe("importing a filled sheet: writing", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  /** A copy of the files the import writes, so the real ones are never touched by a test. */
  function copy() {
    const root = mkdtempSync(path.join(os.tmpdir(), "kit-"));
    dirs.push(root);
    cpSync(path.join(WEB, "i18n/strings"), path.join(root, "i18n/strings"), { recursive: true });
    cpSync(path.join(WEB, "i18n/review"), path.join(root, "i18n/review"), { recursive: true });
    mkdirSync(path.join(root, "lib/legal"), { recursive: true });
    for (const f of ["privacy-text", "data-deletion-text"]) for (const sfx of ["", ".te", ".hi", ".kn"]) cpSync(path.join(WEB, `lib/legal/${f}${sfx}.ts`), path.join(root, `lib/legal/${f}${sfx}.ts`));
    return root;
  }
  const json = (root: string, set: string) => JSON.parse(readFileSync(path.join(root, `i18n/strings/${set}.json`), "utf8"));

  it("writes a correction to the string file, marks it reviewed, and changes nothing else", () => {
    const root = copy();
    const s = loadSources(root) as unknown as Src;
    const r = first("hi", (x) => x.key.startsWith("app.") && !/\{\w+\}/.test(x.en));
    const before = json(root, "app");
    const plan = planImport("hi", s, filled("hi", { [r.key]: { corrected: "सुधारा हुआ टेक्स्ट" } }));
    expect(plan.errors).toEqual([]);
    expect(applyPlan("hi", s, plan, { root })).toEqual(["i18n/strings/app.json"]);
    const after = json(root, "app");
    const k = r.key.slice(4);
    expect(after[k].hi).toBe("सुधारा हुआ टेक्स्ट");
    expect(after[k].status.hi).toBe("reviewed");
    expect(after[k].te).toBe(before[k].te);
    expect(after[k].status.te).toBe("draft");
    for (const other of Object.keys(before).filter((x) => x !== k)) expect(after[other], other).toEqual(before[other]);
  });
  it("a sample chat (the same text in every dictionary) is written in all four", () => {
    const root = copy();
    const s = loadSources(root) as unknown as Src;
    const r = first("te", (x) => x.key === "site.langs.sample.te.q");
    expect(r.en).toContain("no English original");
    const plan = planImport("te", s, filled("te", { [r.key]: { corrected: "నమస్తే, ధర ఎంత?" } }));
    expect(plan.errors).toEqual([]);
    applyPlan("te", s, plan, { root });
    const e = json(root, "site")["langs.sample.te.q"];
    expect([e.en, e.te, e.hi, e.kn]).toEqual(Array(4).fill("నమస్తే, ధర ఎంత?"));
    expect(e.status.te).toBe("reviewed");
  });
  it("writes a legal sentence into its text file, keeps the file readable, and notes the sentence as reviewed", () => {
    const root = copy();
    const s = loadSources(root) as unknown as Src;
    const r = first("kn", (x) => x.key === "privacy.intro.0");
    const fixed = `${r.current} (ಪರಿಶೀಲಿಸಲಾಗಿದೆ)`;
    const plan = planImport("kn", s, filled("kn", { [r.key]: { corrected: fixed } }));
    expect(plan.errors).toEqual([]);
    expect(applyPlan("kn", s, plan, { root }).sort()).toEqual(["i18n/review/legal-reviewed.json", "lib/legal/privacy-text.kn.ts"]);
    const { doc } = readLegalFile(path.join(root, "lib/legal/privacy-text.kn.ts"));
    expect(flattenLegal(doc).find((x: { id: string }) => x.id === "intro.0")?.text).toBe(fixed);
    expect(flattenLegal(doc)).toHaveLength(src.legal.privacy.kn.flat.length);
    expect(JSON.parse(readFileSync(path.join(root, "i18n/review/legal-reviewed.json"), "utf8"))).toEqual({ privacy: { kn: ["intro.0"] } });
    expect(readFileSync(path.join(root, "lib/legal/privacy-text.te.ts"), "utf8")).toBe(readFileSync(path.join(WEB, "lib/legal/privacy-text.te.ts"), "utf8"));
  });
  it("with --mark-unchanged-reviewed every row of the sheet becomes reviewed, text untouched", () => {
    const root = copy();
    const s = loadSources(root) as unknown as Src;
    const plan = planImport("te", s, sheetCsv(buildRows("te", s)), { markUnchanged: true });
    applyPlan("te", s, plan, { root });
    const app = json(root, "app");
    const kitKeys = buildRows("te", s).filter((x: Row) => x.key.startsWith("app.")).map((x: Row) => x.key.slice(4));
    for (const k of kitKeys) expect(app[k].status.te, k).toBe("reviewed");
    expect(Object.values(app).filter((e: unknown) => (e as { status: { te?: string } }).status.te === "reviewed")).toHaveLength(kitKeys.length);
    expect(app[kitKeys[0]].te).toBe(src.sets.app[kitKeys[0]].te);
    const done = JSON.parse(readFileSync(path.join(root, "i18n/review/legal-reviewed.json"), "utf8"));
    expect(Object.keys(done).sort()).toEqual(["data-deletion", "privacy"]);
  });
});

describe("the two commands", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-cli-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (script: string, ...args: string[]) => spawnSync(process.execPath, [path.join(WEB, "scripts", script), ...args], { encoding: "utf8" });
  it("export writes the sheets and the note where it is told to", () => {
    const out = path.join(dir, "kit");
    const r = run("review-kit-export.mjs", "--out", out);
    expect(r.status, r.stderr).toBe(0);
    for (const l of KIT_LANGS) {
      expect(parseCsv(readFileSync(path.join(out, l, `review-${l}.csv`), "utf8"))[0]).toEqual(KIT_HEADER);
      expect(readFileSync(path.join(out, l, `review-${l}.html`), "utf8")).toContain(`Review sheet:`);
    }
    expect(readFileSync(path.join(out, "HOW-TO-REVIEW.md"), "utf8")).toContain("How to review");
    expect(readFileSync(path.join(out, "HOW-TO-REVIEW.html"), "utf8")).toContain("<h1>");
    expect(run("review-kit-export.mjs", "--lang", "xx").status).toBe(2);
  });
  it("import refuses a bad sheet (exit 1, nothing written) and accepts a good one in a dry run", () => {
    const r = first("te", (x) => x.key.startsWith("login.") && !/\{\w+\}/.test(x.en));
    const bad = path.join(dir, "bad.csv");
    writeFileSync(bad, filled("te", { [r.key]: { corrected: "అభ్యర్థన" } }));
    const refused = run("review-kit-import.mjs", "--lang", "te", bad, "--dry-run");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("nothing was written");
    const good = path.join(dir, "good.csv");
    writeFileSync(good, filled("te", { [r.key]: { corrected: "మంచి టెక్స్ట్", comment: "సరే" } }));
    const ok = run("review-kit-import.mjs", "--lang", "te", good, "--dry-run");
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("1 text(s) corrected");
    expect(ok.stdout).toContain("dry run: nothing written.");
    expect(run("review-kit-import.mjs", good).status).toBe(2);
  });
});
