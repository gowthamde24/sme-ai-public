// Shared helpers for the i18n scripts: load the master string files, count drafts, read and write the
// review CSV. Plain Node, no dependencies. The master files are apps/web/i18n/strings/*.json.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** apps/web */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const STRINGS_DIR = path.join(ROOT, "i18n/strings");
export const LANGS = ["te", "hi", "kn"];
export const LANG_NAMES = { te: "Telugu", hi: "Hindi", kn: "Kannada" };
/** The string sets the port carries so far (landing and login). New sets are added with the stage that uses them. */
export const SETS = ["landing", "login"];

export function loadSets(dir = STRINGS_DIR) {
  const out = {};
  for (const name of SETS) out[name] = JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8"));
  return out;
}

export function saveSet(name, data, dir = STRINGS_DIR) {
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 1) + "\n");
}

/** The languages a string really exists in (most strings: all three). */
export const langsOf = (entry) => (Array.isArray(entry.only) ? entry.only : LANGS);

/** Every (set, key, lang) the owner has to read, in file order. */
export function* reviewRows(sets) {
  for (const lang of LANGS) {
    for (const [set, data] of Object.entries(sets)) {
      for (const [key, entry] of Object.entries(data)) {
        if (langsOf(entry).includes(lang)) yield { set, key, lang, entry };
      }
    }
  }
}

/** Problems with the status data itself: missing or unknown status, empty text, mismatched placeholders. */
export function validate(sets) {
  const problems = [];
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const { set, key, lang, entry } of reviewRows(sets)) {
    const st = entry.status?.[lang];
    if (st !== "draft" && st !== "reviewed") problems.push(`${set}:${key}:${lang} has status ${JSON.stringify(st)}`);
    if (typeof entry[lang] !== "string" || !entry[lang].trim()) problems.push(`${set}:${key}:${lang} is empty`);
    else if (!(entry.only && entry.only.length) && ph(entry[lang]) !== ph(entry.en)) {
      problems.push(`${set}:${key}:${lang} has different {placeholders} from English`);
    }
  }
  return problems;
}

/** { te: { draft, reviewed, total }, hi: ..., kn: ... } */
export function countStatus(sets) {
  const c = Object.fromEntries(LANGS.map((l) => [l, { draft: 0, reviewed: 0, total: 0 }]));
  for (const { lang, entry } of reviewRows(sets)) {
    c[lang].total++;
    if (entry.status?.[lang] === "reviewed") c[lang].reviewed++;
    else c[lang].draft++;
  }
  return c;
}

// ------------------------------------------------------------------ where a string appears
const LANDING = [
  [/^skip$/, "Landing page: skip link"],
  [/^(lang|theme)\./, "Landing page: header, language and theme buttons"],
  [/^nav\./, "Landing page: header menu"],
  [/^hero\./, "Landing page: top section (hero)"],
  [/^(anim|flow|card)\./, "Landing page: the moving flow strip under the hero"],
  [/^problem\./, "Landing page: \"does this happen to you\" section"],
  [/^(how|step)\./, "Landing page: how it works (six steps)"],
  [/^(control|ctl|life)\./, "Landing page: you stay in control"],
  [/^(team|role)\./, "Landing page: the team"],
  [/^langs\./, "Landing page: languages"],
  [/^(privacy|priv)\./, "Landing page: privacy"],
  [/^early\./, "Landing page: early access box"],
  [/^faq\./, "Landing page: questions and answers"],
  [/^foot\./, "Landing page: footer"],
  [/^meta\./, "Landing page: browser tab title and search description"],
];
const LOGIN = [
  [/^(skip|home|lang|theme)/, "Login page: header and links"],
  [/^side\./, "Login page: side panel"],
  [/^signin\./, "Login page: e-mail and password step"],
  [/^code\./, "Login page: 6-digit code step"],
  [/^err\./, "Login page: error messages"],
  [/^meta\./, "Login page: browser tab title and search description"],
];
export function whereIs(set, key) {
  const table = { landing: LANDING, login: LOGIN }[set];
  return table?.find(([re]) => re.test(key))?.[1] ?? `${set}`;
}

// ------------------------------------------------------------------ CSV
export function csvLine(cells) {
  return cells.map((c) => (/[",\n\r]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(",");
}

/** RFC 4180 reader: quoted fields, doubled quotes, newlines inside quotes. Strips a leading BOM. */
export function parseCsv(text) {
  const s = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((c) => c !== "")) rows.push(row); }
  return rows;
}

/**
 * Wording that has money, tax or legal meaning: the owner must have the CA / lawyer read the final text.
 * Found from the English text, so every translation of a flagged string is flagged too.
 */
const SENSITIVE_TOPICS = [
  [/\bheld\b/i, "money held"],
  [/workspace/i, "workspace / your account"],
  [/\brefund/i, "refund"],
  [/\badvance/i, "advance"],
  [/\bconsent/i, "consent"],
  [/\bpayment/i, "payment"],
  [/\bGST\b/, "GST"],
];
export function sensitivityNote(en) {
  const notes = SENSITIVE_TOPICS.filter(([re]) => re.test(en)).map(([, label]) => label);
  return notes.length ? `OWNER/LEGAL-SENSITIVE (${notes.join("; ")}): final wording must match the CA/lawyer's view` : "";
}

/** What a visitor sees on the landing and sign-in pages (everything carried so far). */
export const isFirstPass = (set, key) => (set === "landing" || set === "login") && typeof key === "string";

export const REVIEW_HEADER = ["key", "language", "where it appears", "English", "current text", "new draft", "owner-edit", "status"];

/**
 * previous: optional { set: { key: { te, hi, kn } } } snapshot of the text before the register change.
 * firstPass: only what a visitor sees on landing + sign-in, each string's three languages side by side.
 * An extra last column "note" flags owner/legal-sensitive wording; the importer ignores it.
 */
export function buildReviewCsv(sets, previous = {}, { firstPass = false } = {}) {
  const lines = [csvLine([...REVIEW_HEADER, "note"])];
  const row = (set, key, lang, entry) => {
    const prev = previous[set]?.[key]?.[lang];
    return csvLine([`${set}.${key}`, lang, whereIs(set, key), entry.en, prev ?? entry[lang], entry[lang], "", entry.status?.[lang] ?? "draft", sensitivityNote(entry.en)]);
  };
  if (firstPass) {
    for (const set of ["landing", "login"]) {
      for (const [key, entry] of Object.entries(sets[set])) {
        if (!isFirstPass(set, key)) continue;
        for (const lang of langsOf(entry)) lines.push(row(set, key, lang, entry));
      }
    }
  } else {
    for (const { set, key, lang, entry } of reviewRows(sets)) lines.push(row(set, key, lang, entry));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/**
 * Applies the owner's edits from a review CSV to the string sets (in memory). A row with text in
 * "owner-edit" replaces the string and becomes "reviewed". A row with no edit whose status cell the
 * owner changed to "reviewed" is accepted as it is. Returns { changed, accepted, errors }.
 */
export function applyReviewCsv(sets, csvText) {
  const rows = parseCsv(csvText);
  const head = rows.shift() ?? [];
  const col = Object.fromEntries(REVIEW_HEADER.map((h) => [h, head.indexOf(h)]));
  const errors = [];
  for (const h of REVIEW_HEADER) if (col[h] < 0) errors.push(`missing column "${h}"`);
  if (errors.length) return { changed: 0, accepted: 0, errors };
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  let changed = 0, accepted = 0;
  for (const r of rows) {
    const id = r[col.key], lang = r[col.language];
    const dot = id.indexOf(".");
    const set = id.slice(0, dot), key = id.slice(dot + 1);
    const entry = sets[set]?.[key];
    if (!entry || !LANGS.includes(lang) || !langsOf(entry).includes(lang)) { errors.push(`unknown row ${id} (${lang})`); continue; }
    const edit = (r[col["owner-edit"]] ?? "").trim();
    const status = (r[col.status] ?? "").trim().toLowerCase();
    if (edit) {
      if (!(entry.only && entry.only.length) && ph(edit) !== ph(entry.en)) {
        errors.push(`${id} (${lang}): the edit has different {placeholders} from English`);
        continue;
      }
      entry[lang] = edit;
      if (entry.only && entry.only.length) for (const l of ["en", "te", "hi", "kn"]) if (set === "landing") entry[l] = edit;
      entry.status[lang] = "reviewed";
      changed++;
    } else if (status === "reviewed" && entry.status[lang] !== "reviewed") {
      entry.status[lang] = "reviewed";
      accepted++;
    }
  }
  return { changed, accepted, errors };
}

export function loadPrevious() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, "i18n/review/previous-strings.json"), "utf8"));
  } catch {
    return {};
  }
}
