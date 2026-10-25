// The native-review kit (job DL): what the owner sends to a Telugu, Hindi or Kannada reader, and how the filled sheet comes back.
// One sheet per language, in CSV (opens in Excel and Google Sheets) and in printable HTML, with the six columns
//   key | English | current draft | corrected | comment | where it appears (page)
// covering: the home page texts and its sample chats, the Privacy Policy, the data-deletion page, the sign-up and sign-in screens, and the 200 app strings people see most.
// The import checks a filled sheet and writes the corrections back: into the JSON string files (i18n/strings/*.json) and, for the two legal texts, into lib/legal/*-text.<lang>.ts. Plain Node, no dependencies.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { LANGS, LANG_NAMES, ROOT, csvLine, parseCsv, saveSet } from "./i18n-data.mjs";

export { ROOT };
export const KIT_LANGS = LANGS;
export const KIT_HEADER = ["key", "English", "current draft", "corrected", "comment", "where it appears (page)"];
export const TOP_APP_STRINGS = 200;
const STRINGS_DIR = path.join(ROOT, "i18n/strings");
const SCREENS_DIR = path.join(ROOT, "test/screens/__text__");
export const REVIEWED_LEGAL_FILE = path.join(ROOT, "i18n/review/legal-reviewed.json");

/** The words the string tests keep out of a language (everyday words are used instead: i18n/STYLE.md). */
export const BOOKISH = { te: ["అభ్యర్థన"], hi: ["अनुरोध"], kn: ["ಮನವಿ"] };
/** What no text may claim (the same list the string tests use: i18n/strings/forbidden.ts), read from that file so the two cannot drift. */
export function forbiddenClaims(root = ROOT) {
  const src = readFileSync(path.join(root, "i18n/strings/forbidden.ts"), "utf8");
  const body = src.slice(src.indexOf("= [") + 2, src.lastIndexOf("];") + 1);
  return vm.runInNewContext(body, Object.create(null), { timeout: 2000 });
}

// ------------------------------------------------------------------------------------------------ sources
const readSet = (name, dir = STRINGS_DIR) => JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8"));
/** The five string files the kit reads and writes. */
export const KIT_SETS = ["site", "login", "signup", "legal", "app"];

/** A legal text file (`export const X: LegalText = {...};`) read as data: the type lines are cut and the object literal is evaluated in an empty sandbox (our own source, no imports, no globals). */
export function readLegalFile(file) {
  const src = readFileSync(file, "utf8");
  const start = src.indexOf("= {", src.indexOf("export const"));
  const end = src.lastIndexOf("};");
  if (start < 0 || end < start) throw new Error(`${file}: not a LegalText file`);
  return { src, doc: vm.runInNewContext(`(${src.slice(start + 2, end + 1)})`, Object.create(null), { timeout: 2000 }) };
}
const LEGAL_FILES = {
  privacy: { en: "privacy-text.ts", te: "privacy-text.te.ts", hi: "privacy-text.hi.ts", kn: "privacy-text.kn.ts" },
  "data-deletion": { en: "data-deletion-text.ts", te: "data-deletion-text.te.ts", hi: "data-deletion-text.hi.ts", kn: "data-deletion-text.kn.ts" },
};
export const LEGAL_DOCS = Object.keys(LEGAL_FILES);

/** A legal document as flat (id, text) pairs: title, intro paragraphs, section titles, paragraphs, list items, table heads and cells. The id is the same in every language (the texts have the same shape). */
export function flattenLegal(doc) {
  const out = [{ id: "title", text: doc.title }];
  doc.intro.forEach((t, i) => out.push({ id: `intro.${i}`, text: t }));
  for (const s of doc.sections) {
    out.push({ id: `${s.id}.title`, text: s.title });
    s.blocks.forEach((b, n) => {
      if ("p" in b) out.push({ id: `${s.id}.b${n}`, text: b.p });
      else if ("ul" in b) b.ul.forEach((t, m) => out.push({ id: `${s.id}.b${n}.li${m}`, text: t }));
      else {
        b.table.head.forEach((t, c) => out.push({ id: `${s.id}.b${n}.head${c}`, text: t }));
        b.table.rows.forEach((r, ri) => r.forEach((t, c) => out.push({ id: `${s.id}.b${n}.r${ri}c${c}`, text: t })));
      }
    });
  }
  return out;
}

export function loadSources(root = ROOT) {
  const dir = path.join(root, "i18n/strings");
  const sets = Object.fromEntries(KIT_SETS.map((n) => [n, readSet(n, dir)]));
  const legal = {};
  for (const [docId, files] of Object.entries(LEGAL_FILES)) {
    legal[docId] = {};
    for (const [lang, file] of Object.entries(files)) {
      const { src, doc } = readLegalFile(path.join(root, "lib/legal", file));
      legal[docId][lang] = { file: path.join(root, "lib/legal", file), src, flat: flattenLegal(doc) };
    }
  }
  return { sets, legal, root };
}

// ------------------------------------------------------------------------------------------------ which strings, and where they are seen
const SITE_WHERE = [
  [/^langs\.sample\./, "Home page: sample chat"],
  [/^home\.lang\./, "Home page: sample chats section"],
  [/^home\.how\./, "Home page: how it works (the six steps)"],
  [/^home\.calls\./, "Home page: calls and voice"],
  [/^home\.(price|trust|biz)/, "Home page: trial, trust and business cards"],
  [/^home\./, "Home page"],
  [/^hero\./, "Home page: top section"],
  [/^(packs|owl)\./, "Home page: the business cards and the helpers"],
  [/^(cta|trust|faq)\./, "Home page: call to action, trust points and questions"],
  [/^preview\./, "Home page: WhatsApp preview"],
  [/^(skip|nav\.|foot\.)/, "Header and footer of every website page"],
];
const siteWhere = (key) => SITE_WHERE.find(([re]) => re.test(key))?.[1] ?? "Home page";
/** The site strings that belong to the home page, its header and footer; `langs.sample.<lang>.*` is the chat written in that language, `home.lang.*` the section around it. */
const siteKeysFor = (data, lang) =>
  Object.keys(data).filter((k) => {
    if (/^langs\.sample\./.test(k)) return new RegExp(`^langs\\.sample\\.${lang}\\.`).test(k);
    return /^(skip|nav\.|foot\.|hero\.|home\.|packs\.|owl\.|cta\.|trust\.|faq\.|preview\.)/.test(k) && !data[k].humanOnly;
  });

const LOGIN_WHERE = [
  [/^side\./, "Sign-in page: side panel"],
  [/^signin\./, "Sign-in page: e-mail and password"],
  [/^code\./, "Sign-in page: the 6-digit code"],
  [/^err\./, "Sign-in page: error messages"],
  [/^meta\./, "Sign-in page: browser tab title"],
];
const SIGNUP_WHERE = [
  [/^signup\.closed\./, "Sign-up page: the note while sign-up is closed"],
  [/^signup\.err\./, "Sign-up page: error messages"],
  [/^signup\./, "Sign-up page"],
  [/^setup\./, "Set-up after sign-up: name your business"],
  [/^checkemail\./, "Sign-up: check your e-mail"],
];
const where = (table, key, fallback) => table.find(([re]) => re.test(key))?.[1] ?? fallback;

/** The text a language's entry has, or null when the string does not exist in that language. */
const textOf = (entry, lang) => (Array.isArray(entry.only) && entry.only.length && !entry.only.includes(lang) ? null : entry[lang]);

// ------------------------------------------------------------------------------------------------ the 200 strings people see most
/**
 * "Most seen" without any usage counting: how many of the app's screens show the string. The screens' plain-text snapshots (test/screens/__text__, one per screen and role) are the record of what each screen says;
 * a string that is on more screens ranks higher. The menu and the top bar (`nav.`, `frame.`) are on every screen, so they come first. Ties keep the order of the string file. Deterministic.
 */
const rankCache = new WeakMap(); // the ranking costs a second (every string against every screen): once per loaded string set
export function rankAppStrings(app, screensDir = SCREENS_DIR) {
  const cached = rankCache.get(app)?.get(screensDir);
  if (cached) return cached;
  const result = computeRanking(app, screensDir);
  rankCache.set(app, (rankCache.get(app) ?? new Map()).set(screensDir, result));
  return result;
}
function computeRanking(app, screensDir) {
  const screens = new Map(); // scenario id -> text of the screen (all roles)
  let files = [];
  try {
    files = readdirSync(screensDir).filter((f) => f.endsWith(".txt"));
  } catch {
    /* no snapshots: only the frame strings rank */
  }
  for (const f of files) {
    const id = f.replace(/\.[a-z]+\.txt$/, "");
    screens.set(id, (screens.get(id) ?? "") + "\n" + readFileSync(path.join(screensDir, f), "utf8"));
  }
  const total = screens.size;
  const everywhere = /^(nav\.|frame\.)/;
  const ranked = [];
  let order = 0;
  for (const [key, entry] of Object.entries(app)) {
    order++;
    if (entry.humanOnly || (Array.isArray(entry.only) && entry.only.length === 0)) continue;
    const parts = entry.en.split(/\{\w+\}/).map((p) => p.trim()).filter((p) => p.length >= 3);
    let seen = [];
    if (everywhere.test(key)) seen = null;
    else if (parts.length) {
      const re = new RegExp(parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*?"));
      seen = [...screens].filter(([, text]) => re.test(text)).map(([id]) => id);
    }
    if (seen !== null && seen.length === 0) continue;
    ranked.push({ key, score: seen === null ? total : seen.length, seen, order });
  }
  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  return { ranked, total };
}
const appWhere = (r, total) =>
  r.seen === null ? (/^nav\./.test(r.key) ? "The menu, on every screen" : "The top bar, plan box and account menu, on every screen") : `Seen on ${r.seen.length} of ${total} screens, for example: ${r.seen.slice(0, 3).join(", ")}`;

// ------------------------------------------------------------------------------------------------ one language's sheet
/** The rows of the sheet of one language, in reading order: { group, key, en, current, where, ref }. `ref` tells the import where the text lives. */
export function buildRows(lang, src, { top = TOP_APP_STRINGS, screensDir = SCREENS_DIR } = {}) {
  const rows = [];
  const fromSet = (group, name, keys, whereOf) => {
    for (const k of keys) {
      const e = src.sets[name][k];
      const cur = textOf(e, lang);
      if (cur === null || cur === undefined) continue;
      // a sample chat is written in its own language: it has no English original, so the English column says so
      const own = Array.isArray(e.only);
      rows.push({ group, key: `${name}.${k}`, en: own ? "(written in the reader's language: no English original)" : e.en, current: cur, where: whereOf(k), ref: { kind: "json", set: name, key: k } });
    }
  };
  fromSet("Home page", "site", siteKeysFor(src.sets.site, lang), siteWhere);
  for (const [docId, group, page] of [["privacy", "Privacy Policy", "Privacy Policy page (/privacy)"], ["data-deletion", "Data-deletion page", "Data-deletion page (/data-deletion)"]]) {
    const en = src.legal[docId].en.flat;
    const mine = src.legal[docId][lang].flat;
    if (en.length !== mine.length || en.some((x, i) => x.id !== mine[i].id)) throw new Error(`${docId}: the ${lang} text does not have the same sections, paragraphs and lists as the English`);
    en.forEach((x, i) => rows.push({ group, key: `${docId}.${x.id}`, en: x.text, current: mine[i].text, where: page, ref: { kind: "legal", doc: docId, id: x.id } }));
  }
  const summaryKeys = Object.keys(src.sets.legal).filter((k) => /^legal\.sum\.(privacy|deletion)\./.test(k));
  fromSet("Privacy Policy", "legal", summaryKeys.filter((k) => /privacy/.test(k)), () => "Privacy Policy page: the short summary at the top");
  fromSet("Data-deletion page", "legal", summaryKeys.filter((k) => /deletion/.test(k)), () => "Data-deletion page: the short summary at the top");
  fromSet("Sign-up", "signup", Object.keys(src.sets.signup).filter((k) => !src.sets.signup[k].humanOnly), (k) => where(SIGNUP_WHERE, k, "Sign-up page"));
  fromSet("Sign-in", "login", Object.keys(src.sets.login).filter((k) => !/^(skip|home|lang|theme)/.test(k) && !src.sets.login[k].humanOnly), (k) => where(LOGIN_WHERE, k, "Sign-in page"));
  const { ranked, total } = rankAppStrings(src.sets.app, screensDir);
  for (const r of ranked.slice(0, top)) {
    const e = src.sets.app[r.key];
    rows.push({ group: "The app: the 200 strings people see most", key: `app.${r.key}`, en: e.en, current: e[lang], where: appWhere(r, total), ref: { kind: "json", set: "app", key: r.key } });
  }
  return rows;
}

export function sheetCsv(rows) {
  return "﻿" + [csvLine(KIT_HEADER), ...rows.map((r) => csvLine([r.key, r.en, r.current, "", "", r.where]))].join("\r\n") + "\r\n";
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = { te: "'Noto Sans Telugu','Nirmala UI','Gautami',sans-serif", hi: "'Noto Sans Devanagari','Nirmala UI','Mangal',sans-serif", kn: "'Noto Sans Kannada','Nirmala UI','Tunga',sans-serif" };
/** The same sheet as one self-contained printable page (A4 landscape): a table per group, the two blank columns left as lined cells. No script, no network. */
export function sheetHtml(lang, rows, { date }) {
  const groups = [...new Set(rows.map((r) => r.group))];
  const body = groups
    .map((g) => {
      const rs = rows.filter((r) => r.group === g);
      return `<h2>${esc(g)} <small>(${rs.length})</small></h2>
<table><thead><tr><th class="k">key</th><th>English</th><th>Current draft (${LANG_NAMES[lang]})</th><th class="w">Corrected</th><th class="w">Comment</th></tr></thead><tbody>
${rs.map((r) => `<tr><td class="k">${esc(r.key)}<br><em>${esc(r.where)}</em></td><td lang="en">${esc(r.en)}</td><td lang="${lang}" class="t">${esc(r.current)}</td><td class="w"></td><td class="w"></td></tr>`).join("\n")}
</tbody></table>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review sheet: ${LANG_NAMES[lang]}</title>
<style>
@page{size:A4 landscape;margin:12mm}
body{font:14px/1.45 system-ui,'Segoe UI',Arial,sans-serif;margin:16px;color:#111}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 6px;break-after:avoid}h2 small{font-weight:400;color:#666}
p.n{margin:0 0 8px;color:#333;max-width:70em}
table{border-collapse:collapse;width:100%;table-layout:fixed}
th,td{border:1px solid #999;padding:5px 7px;vertical-align:top;text-align:left;overflow-wrap:anywhere}
th{background:#eee;font-size:12px}tr{break-inside:avoid}
td.t{font-family:${FONT[lang]};font-size:15px}
td.k{width:15%;font-size:11px;color:#444}td.k em{display:block;color:#777;font-style:normal;margin-top:2px}
th.w,td.w{width:22%;height:34px}
@media print{body{margin:0}}
</style></head><body>
<h1>Review sheet: ${LANG_NAMES[lang]}</h1>
<p class="n">${rows.length} texts, made ${esc(date)}. Read the “Current draft” column. Where it is wrong or unnatural, write the better text in “Corrected”. Add a note in “Comment” if you want. Keep anything in {curly brackets} exactly as it is. Details: HOW-TO-REVIEW.</p>
${body}
</body></html>
`;
}

// ------------------------------------------------------------------------------------------------ the filled sheet comes back
const tokens = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const literal = (s) => JSON.stringify(s);

/**
 * Checks a filled sheet and works out what to write; nothing is written here. Every problem is collected (one per row) so the reviewer or the owner can fix them all at once.
 * A row with nothing in "corrected" is left as it is (and, with `markUnchanged`, marked reviewed: the reviewer read it and found it right).
 * Refused: a language with no such sheet row, a key that is not in the kit, a row twice, a draft that is no longer the repository's current text (the sheet is out of date), {tokens} added, lost or changed,
 * a correction that is only spaces, an everyday-word rule broken (STYLE.md), or a claim the site may not make.
 */
export function planImport(lang, src, csvText, { markUnchanged = false, allowStale = false, top = TOP_APP_STRINGS, screensDir = SCREENS_DIR } = {}) {
  const errors = [];
  const warnings = [];
  const rows = parseCsv(csvText);
  const head = rows.shift() ?? [];
  const col = Object.fromEntries(KIT_HEADER.map((h) => [h, head.map((x) => x.trim().toLowerCase()).indexOf(h.toLowerCase())]));
  for (const h of KIT_HEADER) if (col[h] < 0) errors.push(`the sheet has no column "${h}"`);
  if (errors.length) return { errors, warnings, edits: [], reviewed: [], comments: [], stats: {} };
  const kit = new Map(buildRows(lang, src, { top, screensDir }).map((r) => [r.key, r]));
  const claims = forbiddenClaims(src.root);
  const seen = new Set();
  const edits = [];
  const reviewed = [];
  const comments = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const key = (r[col.key] ?? "").trim();
    const row = kit.get(key);
    if (!key) return void errors.push(`line ${line}: the key is empty`);
    if (!row) return void errors.push(`line ${line}: "${key}" is not a text of the ${LANG_NAMES[lang]} sheet (wrong language, or the sheet is from another version)`);
    if (seen.has(key)) return void errors.push(`line ${line}: "${key}" appears twice`);
    seen.add(key);
    const comment = (r[col.comment] ?? "").trim();
    if (comment) comments.push({ key, comment });
    const was = r[col["current draft"]] ?? "";
    if (was !== row.current && !allowStale) errors.push(`line ${line}: "${key}": the "current draft" is not the text in the repository now (the sheet is out of date, or the cell was changed). Write your fix in "corrected" and leave "current draft" alone`);
    const fix = r[col.corrected] ?? "";
    if (fix === "") {
      if (markUnchanged) reviewed.push(row);
      return;
    }
    const text = fix.trim();
    if (!text) return void errors.push(`line ${line}: "${key}": "corrected" is only spaces. Leave it empty to keep the draft`);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return void errors.push(`line ${line}: "${key}": the corrected text has a control character`);
    const english = row.ref.kind === "json" && Array.isArray(src.sets[row.ref.set][row.ref.key].only) ? row.current : row.en;
    if (tokens(text) !== tokens(english)) errors.push(`line ${line}: "${key}": the {tokens} are not the same as in ${english === row.current ? "the draft" : "English"} (needs: ${tokens(english) || "none"}; found: ${tokens(text) || "none"}). Keep {curly bracket} words exactly as they are`);
    for (const w of BOOKISH[lang]) if (text.includes(w)) errors.push(`line ${line}: "${key}": uses "${w}", a bookish word the style guide keeps out (see STYLE.md)`);
    for (const [re, label] of claims) if (re.test(text)) errors.push(`line ${line}: "${key}": says something we cannot prove (${label})`);
    edits.push({ ...row, corrected: text });
  });
  // a legal sentence that is written more than once in its file is replaced everywhere, so every row with that sentence must carry the same correction
  const legalRows = [...kit.values()].filter((r) => r.ref.kind === "legal");
  const told = new Set();
  for (const e of edits.filter((x) => x.ref.kind === "legal")) {
    const twins = legalRows.filter((r) => r.ref.doc === e.ref.doc && r.current === e.current);
    const id = `${e.ref.doc}|${e.current}`;
    if (told.has(id)) continue;
    told.add(id);
    const count = src.legal[e.ref.doc][lang].src.split(literal(e.current)).length - 1;
    if (count !== twins.length) errors.push(`"${e.key}": the sentence is written ${count} time(s) in ${path.basename(src.legal[e.ref.doc][lang].file)} but the sheet has ${twins.length} row(s) for it; fix it by hand`);
    else if (twins.some((t) => edits.find((x) => x.key === t.key)?.corrected !== e.corrected)) errors.push(`"${e.key}": the same sentence is in ${twins.length} places; give the same correction in each (${twins.map((t) => t.key).join(", ")})`);
  }
  const absent = [...kit.keys()].filter((k) => !seen.has(k));
  if (absent.length) warnings.push(`${absent.length} text(s) of the kit are not in this sheet (rows deleted?): they stay as they are`);
  return { errors, warnings, edits, reviewed, comments, stats: { rows: rows.length, corrected: edits.length, unchangedReviewed: reviewed.length, comments: comments.length } };
}

/** Writes a plan made by planImport: the JSON string files, the legal text files, and the list of legal texts a reader has been through. Returns the files written. */
export function applyPlan(lang, src, plan, { root = ROOT } = {}) {
  const written = new Set();
  const legalDone = (() => {
    try {
      return JSON.parse(readFileSync(path.join(root, "i18n/review/legal-reviewed.json"), "utf8"));
    } catch {
      return {};
    }
  })();
  const touched = new Set();
  const all = [...plan.edits, ...plan.reviewed];
  for (const row of all) {
    const fix = row.corrected;
    if (row.ref.kind === "json") {
      const e = src.sets[row.ref.set][row.ref.key];
      if (fix !== undefined) {
        if (Array.isArray(e.only)) for (const l of ["en", "te", "hi", "kn"]) e[l] = fix; // a text that is the same in every dictionary (a sample chat) is written in all four
        else e[lang] = fix;
      }
      e.status = { ...(e.status ?? {}), [lang]: "reviewed" };
      touched.add(row.ref.set);
    } else {
      const file = src.legal[row.ref.doc][lang];
      if (fix !== undefined && fix !== row.current) file.src = file.src.split(literal(row.current)).join(literal(fix));
      file.dirty = true;
      const list = ((legalDone[row.ref.doc] ??= {})[lang] ??= []);
      if (!list.includes(row.ref.id)) list.push(row.ref.id);
    }
  }
  for (const set of touched) {
    saveSet(set, src.sets[set], path.join(root, "i18n/strings"));
    written.add(`i18n/strings/${set}.json`);
  }
  for (const docId of LEGAL_DOCS) {
    const f = src.legal[docId][lang];
    if (f.dirty) {
      writeFileSync(f.file, f.src);
      written.add(path.relative(root, f.file));
    }
  }
  if (all.some((r) => r.ref.kind === "legal")) {
    for (const d of Object.values(legalDone)) for (const l of Object.keys(d)) d[l].sort();
    writeFileSync(path.join(root, "i18n/review/legal-reviewed.json"), JSON.stringify(legalDone, null, 1) + "\n");
    written.add("i18n/review/legal-reviewed.json");
  }
  return [...written];
}

// ------------------------------------------------------------------------------------------------ the note for the reviewers
/** The one-page note (a small markdown: # headings, paragraphs, - lists, **bold**) as a printable page. */
export function noteHtml(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const out = [];
  let list = false;
  for (const line of md.split("\n")) {
    const isLi = /^- /.test(line);
    if (list && !isLi) {
      out.push("</ul>");
      list = false;
    }
    if (/^# /.test(line)) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (/^## /.test(line)) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (isLi) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
    }
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>How to review</title>
<style>@page{size:A4;margin:11mm}body{font:12.5px/1.4 system-ui,'Segoe UI',Arial,sans-serif;max-width:54em;margin:16px auto;padding:0 16px;color:#111}h1{font-size:19px;margin:0 0 6px}h2{font-size:14px;margin:12px 0 2px}p,li{margin:3px 0}ul{margin:2px 0;padding-left:1.3em}code{background:#eee;padding:0 3px}@media print{body{margin:0;padding:0}}</style></head><body>
${out.join("\n")}
</body></html>
`;
}
