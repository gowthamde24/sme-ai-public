import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyOwnerSheet,
  applyReviewCsv,
  isOwnerSheet,
  buildReviewCsv,
  countStatus,
  csvLine,
  isFirstPass,
  loadSets,
  parseCsv,
  sensitivityNote,
  validate,
  whereIs,
} from "./i18n-data.mjs";

type Entry = { en: string; te: string; hi: string; kn: string; status: Record<string, string>; only?: string[] };
type Sets = Record<string, Record<string, Entry>>;
const ALL = { te: "draft", hi: "draft", kn: "draft" };
const small = (): Sets => ({
  landing: {
    "hero.cta": { en: "Request early access", te: "టె", hi: "हि", kn: "ಕ", status: { te: "draft", hi: "draft", kn: "draft" } },
    "foot.copy": { en: "© {year}", te: "© {year}", hi: "© {year}", kn: "© {year}", status: {}, only: [] },
    "langs.sample.te": { en: "తె", te: "తె", hi: "తె", kn: "తె", status: { te: "draft" }, only: ["te"] },
  },
  login: { "err.network": { en: "No {x}", te: "ఎ {x}", hi: "ह {x}", kn: "ಕ {x}", status: ALL as never } },
});
const cell = (rows: string[][], key: string, lang: string, col: number) => rows.find((r) => r[0] === key && r[1] === lang)![col];

describe("i18n status", () => {
  it("counts drafts per language and skips strings that do not exist in a language", () => {
    const c = countStatus(small());
    expect(c.te).toEqual({ draft: 3, reviewed: 0, total: 3 });
    expect(c.hi).toEqual({ draft: 2, reviewed: 0, total: 2 });
  });
  it("the real store has no problems and counts every language", () => {
    const sets = loadSets();
    expect(validate(sets)).toEqual([]);
    const c = countStatus(sets);
    for (const l of ["te", "hi", "kn"]) expect(c[l].total).toBe(c[l].draft + c[l].reviewed);
  });
  it("flags a missing status and a changed placeholder", () => {
    const s = small();
    delete s.landing["hero.cta"].status.hi;
    s.login["err.network"].kn = "ಕ";
    const p = validate(s).join("\n");
    expect(p).toContain("landing:hero.cta:hi");
    expect(p).toContain("login:err.network:kn has different {placeholders}");
  });
});

describe("review sheet", () => {
  it("round-trips commas, quotes and new lines", () => {
    const rows = parseCsv("﻿a,b\r\n" + csvLine(['x,"y"', "line1\nline2"]) + "\r\n");
    expect(rows).toEqual([["a", "b"], ['x,"y"', "line1\nline2"]]);
  });
  it("lists every string once per language, with the previous text as 'current text'", () => {
    const rows = parseCsv(buildReviewCsv(small(), { landing: { "hero.cta": { te: "పాత" } } }));
    expect(rows[0]).toEqual(["key", "language", "where it appears", "English", "current text", "new draft", "owner-edit", "status", "note"]);
    expect(rows.filter((r) => r[1] === "te").map((r) => r[0])).toEqual(["landing.hero.cta", "landing.langs.sample.te", "login.err.network"]);
    expect(rows.find((r) => r[0] === "landing.hero.cta" && r[1] === "te")).toEqual([
      "landing.hero.cta", "te", whereIs("landing", "hero.cta"), "Request early access", "పాత", "టె", "", "draft", "",
    ]);
    expect(rows.some((r) => r[0] === "landing.foot.copy")).toBe(false);
  });
  it("an owner edit replaces the text and marks it reviewed; an untouched row stays draft", () => {
    const s = small();
    const rows = parseCsv(buildReviewCsv(s));
    rows.find((r) => r[0] === "landing.hero.cta" && r[1] === "te")![6] = "కొత్త";
    rows.find((r) => r[0] === "login.err.network" && r[1] === "hi")![7] = "reviewed";
    const out = applyReviewCsv(s, rows.map((r) => csvLine(r)).join("\r\n"));
    expect(out).toEqual({ changed: 1, accepted: 1, errors: [] });
    expect(s.landing["hero.cta"].te).toBe("కొత్త");
    expect(s.landing["hero.cta"].status.te).toBe("reviewed");
    expect(s.landing["hero.cta"].status.hi).toBe("draft");
    expect(s.login["err.network"].status.hi).toBe("reviewed");
  });
  it("refuses an edit that drops a {placeholder}", () => {
    const s = small();
    const rows = parseCsv(buildReviewCsv(s));
    rows.find((r) => r[0] === "login.err.network" && r[1] === "te")![6] = "ఎ";
    const out = applyReviewCsv(s, rows.map((r) => csvLine(r)).join("\r\n"));
    expect(out.changed).toBe(0);
    expect(out.errors[0]).toContain("placeholders");
    expect(s.login["err.network"].te).toBe("ఎ {x}");
    expect(s.login["err.network"].status.te).toBe("draft");
  });
  it("says where each kind of string appears", () => {
    expect(whereIs("site", "hero.h1")).toMatch(/hero/);
    expect(whereIs("login", "err.network")).toMatch(/error/i);
  });
});

describe("first-pass sheet and sensitive wording", () => {
  it("lists the website and sign-in strings, three languages side by side", () => {
    const rows = parseCsv(buildReviewCsv(loadSets(), {}, { firstPass: true }));
    const body = rows.slice(1);
    expect(body.length).toBeGreaterThan(300);
    for (const r of body) expect(/^(site|login)\./.test(r[0]), r[0]).toBe(true);
    expect(body.some((r) => r[0] === "site.foot.copy")).toBe(false);
    const i = body.findIndex((r) => r[0] === "site.hero.h1");
    expect(body.slice(i, i + 3).map((r) => r[1])).toEqual(["te", "hi", "kn"]);
    expect(isFirstPass("app", "nav.today")).toBe(false);
  });
  it("flags money-held, workspace, refund, advance, consent, payment and GST wording, and nothing else", () => {
    expect(sensitivityNote("Money still held: {amount}.")).toMatch(/OWNER\/LEGAL-SENSITIVE \(money held\).*CA\/lawyer/);
    expect(sensitivityNote("Workspace")).toMatch(/workspace/);
    expect(sensitivityNote("Refund given: {amount}")).toMatch(/\(refund\)/);
    expect(sensitivityNote("Advance received: {amount}")).toMatch(/\(advance\)/);
    expect(sensitivityNote("Consent ledger")).toMatch(/\(consent\)/);
    expect(sensitivityNote("Payment received")).toMatch(/\(payment\)/);
    expect(sensitivityNote("Quote total, GST included")).toMatch(/\(GST\)/);
    expect(sensitivityNote("A refund may be owed, after the advance")).toMatch(/\(refund; advance\)/);
    expect(sensitivityNote("Request early access")).toBe("");
    expect(sensitivityNote("Turn enquiries into orders")).toBe("");
    const rows = parseCsv(buildReviewCsv(loadSets(), {}, { firstPass: true }));
    expect(cell(rows, "site.price.terms.3", "te", 8)).toMatch(/refund/);
  });
});

describe("review sheet round trip on the real strings", () => {
  const texts = (sets: Sets) =>
    JSON.stringify(Object.fromEntries(Object.entries(sets).map(([n, d]) => [n, Object.fromEntries(Object.entries(d).map(([k, e]) => [k, [e.en, e.te, e.hi, e.kn]]))])));
  it("the data holds no joiner we added: only authored ZWNJ may appear, never ZWJ or the word joiner", () => {
    expect(texts(loadSets() as Sets)).not.toMatch(/‍|⁠|‑|​|﻿/);
  });
  for (const firstPass of [false, true]) {
    it(`${firstPass ? "first-pass" : "full"} sheet: export, copy new draft into owner-edit, import: every text identical`, () => {
      const sets = loadSets() as Sets;
      const before = texts(sets);
      const rows = parseCsv(buildReviewCsv(sets, {}, { firstPass }));
      expect(rows.length).toBeGreaterThan(300);
      const iEdit = rows[0].indexOf("owner-edit"), iNew = rows[0].indexOf("new draft");
      for (const r of rows.slice(1)) r[iEdit] = r[iNew];
      const csv = rows.map((r) => csvLine(r)).join("\r\n");
      expect(csv).not.toMatch(/⁠|‍/);
      const fresh = loadSets() as Sets;
      const out = applyReviewCsv(fresh, csv);
      expect(out.errors).toEqual([]);
      expect(out.changed).toBe(rows.length - 1);
      expect(texts(fresh)).toBe(before);
    });
  }
});

describe("PUBLIC_LAUNCH_REQUIRES_REVIEWED", () => {
  const script = path.resolve(import.meta.dirname, "../i18n-status.mjs");
  const run = (flag?: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.PUBLIC_LAUNCH_REQUIRES_REVIEWED;
    if (flag !== undefined) env.PUBLIC_LAUNCH_REQUIRES_REVIEWED = flag;
    return spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  };
  it("prints the draft count and does not fail when the flag is not set", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Telugu\s+\d+ draft/);
    expect(r.stdout).toMatch(/Hindi\s+\d+ draft/);
    expect(r.stdout).toMatch(/Kannada\s+\d+ draft/);
  });
  it("does not fail when the flag is 0 or false", () => {
    expect(run("0").status).toBe(0);
    expect(run("false").status).toBe(0);
  });
  it("fails when the flag is set and any string is still a draft", () => {
    const r = run("1");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/still draft/);
  });
});

describe("the owner's Customer Zero sheet", () => {
  const store = (): Sets => ({
    app: {
      "a.one": { en: "Today", te: "old1", hi: "x", kn: "x", status: { te: "draft", hi: "draft", kn: "draft" } },
      "a.two": { en: "{n} new", te: "old2 {n}", hi: "x", kn: "x", status: { te: "draft", hi: "draft", kn: "draft" } },
      "a.money": { en: "Costs {rupees}", te: "Costs {rupees}", hi: "x", kn: "x", status: { te: "draft", hi: "draft", kn: "draft" }, humanOnly: true } as never,
    },
  });
  const head = "key,screen,English,telugu,planner_check,planner_note,owner_edit,draft_before";
  const sheet = (...lines: string[]) => [head, ...lines].join("\r\n");
  const ROWS = [
    "a.one,Today,Today,ఈరోజు,ok,,,",
    "a.two,Today,{n} new,{n} కొత్తవి,CHANGED,,,",
    'a.money,Phone,Costs {rupees},"{rupees} ఖర్చు",YOU MUST READ (consent/money/legal),,,',
  ];
  it("is recognised by its header, and the older review sheet is not", () => {
    expect(isOwnerSheet(sheet())).toBe(true);
    expect(isOwnerSheet("key,language,where it appears,English,current text,new draft,owner-edit,status")).toBe(false);
  });
  it("drafts: writes the proposed Telugu as drafts, nothing reviewed, and skips the consent / money / legal line", () => {
    const s = store();
    const r = applyOwnerSheet(s, sheet(...ROWS), { mode: "drafts" });
    expect(r).toMatchObject({ written: 2, skippedHumanOnly: ["a.money"], errors: [] });
    expect(s.app["a.one"].te).toBe("ఈరోజు");
    expect(s.app["a.two"].te).toBe("{n} కొత్తవి");
    expect(s.app["a.one"].status.te).toBe("draft");
    expect(s.app["a.money"].te).toBe("Costs {rupees}");
  });
  it("approve: a blank owner_edit approves the proposed Telugu, but NOT on a YOU MUST READ row", () => {
    const s = store();
    const r = applyOwnerSheet(s, sheet(...ROWS));
    expect(r).toMatchObject({ approved: 2, pending: ["a.money"], errors: [] });
    expect(s.app["a.one"]).toMatchObject({ te: "ఈరోజు" });
    expect(s.app["a.one"].status.te).toBe("reviewed");
    expect(s.app["a.money"].status.te).toBe("draft");
    expect(s.app["a.money"].te).toBe("Costs {rupees}");
  });
  it("approve: ok approves a YOU MUST READ row as proposed; text in owner_edit replaces the Telugu; hi and kn are never touched", () => {
    const s = store();
    const rows = ["a.one,Today,Today,ఈరోజు,ok,,నేడు,", "a.two,Today,{n} new,{n} కొత్తవి,CHANGED,,ok,", 'a.money,Phone,Costs {rupees},"{rupees} ఖర్చు",YOU MUST READ (consent/money/legal),,ok,'];
    const r = applyOwnerSheet(s, sheet(...rows));
    expect(r).toMatchObject({ approved: 3, edited: 1, pending: [], errors: [] });
    expect(s.app["a.one"].te).toBe("నేడు");
    expect(s.app["a.money"]).toMatchObject({ te: "{rupees} ఖర్చు" });
    expect(s.app["a.money"].status.te).toBe("reviewed");
    expect(s.app["a.one"].status.hi).toBe("draft");
  });
  it("a refusal word in owner_edit approves nothing and an edit that drops a placeholder is refused", () => {
    const s = store();
    const r = applyOwnerSheet(s, sheet("a.one,Today,Today,ఈరోజు,ok,,no,", "a.two,Today,{n} new,{n} కొత్తవి,CHANGED,,కొత్తవి,"));
    expect(r.refused).toEqual(["a.one"]);
    expect(r.errors[0]).toContain("placeholders");
    expect(s.app["a.one"].status.te).toBe("draft");
    expect(s.app["a.two"].status.te).toBe("draft");
  });
  it("an unknown key is reported", () => {
    expect(applyOwnerSheet(store(), sheet("zz.none,X,X,ఎ,ok,,,")).errors).toEqual(["unknown key zz.none"]);
  });
});
