import { CATEGORIES, DRAFT_LANGS, NAME_TOKEN, type Draft, type DraftLang } from "@/lib/templates/meta-checks";
import { OWN_STATUSES, REJECTION_CODES, type OwnMessage, type OwnTitle, type Rejection, type RejectionCode, type WrittenMessage } from "@/lib/templates/types";

import { bad, list, oneOf, optIso, optStr, rec, str, word } from "./shape";

/**
 * THE PARSERS of the own-message builder (the ONE place the API's wire shape is read; the proposal for C1 is in contracts/template-builder-web-needs.md). Closed words (language, group, status) are checked; a text that carries any brace but `{name}`
 * (a wire form of a variable the web does not know, `{{1}}`) is refused, so a brace can never reach the screen. A reason code the web has no sentence for reads as `other` (never an error: the owner must still see the message and a way to change it).
 */
const BODY_MAX = 1100;
const LINE_MAX = 80;

/** A text of the message: no brace but `{name}` may be in it. */
export function text(v: unknown, what: string, max: number): string {
  const s = str(v, what, max);
  if (s.split(NAME_TOKEN).join("").match(/[{}]/)) bad(`${what} has a variable the web does not know`);
  return s;
}

function parseDraft(row: unknown, seen: Set<DraftLang>): { lang: DraftLang; draft: Draft } {
  const x = rec(row, "draft");
  const lang = oneOf(x.language, DRAFT_LANGS, "draft.language");
  if (seen.has(lang)) bad("draft.language twice");
  seen.add(lang);
  const buttons = x.buttons === undefined || x.buttons === null ? [] : list(x.buttons, "draft.buttons", 3).map((b) => text(b, "draft.button", 40));
  return { lang, draft: { header: x.header === null || x.header === undefined ? null : text(x.header, "draft.header", LINE_MAX), body: text(x.body, "draft.body", BODY_MAX), footer: x.footer === null || x.footer === undefined ? null : text(x.footer, "draft.footer", LINE_MAX), buttons } };
}

/** `{title: {en, te?}, category, drafts: [{language, header?, body, footer?, buttons?}]}`: both languages are there, once each. */
export function parseWritten(json: unknown): WrittenMessage {
  const x = rec(json, "written message");
  const seen = new Set<DraftLang>();
  const parsed = list(x.drafts, "drafts", 4).map((row) => parseDraft(row, seen));
  const drafts = Object.fromEntries(parsed.map((p) => [p.lang, p.draft])) as Partial<Record<DraftLang, Draft>>;
  if (!drafts.te || !drafts.en) bad("drafts need te and en");
  return { category: oneOf(x.category, CATEGORIES, "category"), title: parseTitle(x.title), drafts: { te: drafts.te, en: drafts.en } };
}

export function parseTitle(v: unknown): OwnTitle {
  const t = rec(v, "title");
  const en = str(t.en, "title.en", 60).trim();
  const te = optStr(t.te, "title.te", 60);
  return { en: en === "" ? bad("title.en") : en, te: te && te.trim() !== "" ? te.trim() : null };
}

/** `{answer: "written", ...} | {answer: "unclear"}`: the assistant could not write it from that sentence. */
export function parseDraftAnswer(json: unknown): { kind: "written"; message: WrittenMessage } | { kind: "unclear" } {
  const x = rec(json, "draft answer");
  if (x.unclear === true) return { kind: "unclear" };
  return { kind: "written", message: parseWritten(x) };
}

const REASON_PARAM = /^[\p{L}\p{M}\p{N} %₹.,'’-]{1,40}$/u;
function parseReason(v: unknown): Rejection | null {
  if (v === null || v === undefined) return null;
  const x = rec(v, "reason");
  const code = (REJECTION_CODES as readonly string[]).includes(x.code as string) ? (x.code as RejectionCode) : "other";
  const params: Record<string, string | number> = {};
  if (x.params !== undefined && x.params !== null) {
    for (const [k, val] of Object.entries(rec(x.params, "reason.params")).slice(0, 4)) {
      word(k, "reason.param", 20);
      if (typeof val === "number" && Number.isFinite(val)) params[k] = val;
      else if (typeof val === "string" && REASON_PARAM.test(val)) params[k] = val;
    }
  }
  return { code, params };
}

export function parseOwnMessage(row: unknown): OwnMessage {
  const x = rec(row, "own message");
  const status = oneOf(x.status, OWN_STATUSES, "status");
  const reason = parseReason(x.reason);
  return { id: word(x.id, "id", 80), title: parseTitle(x.title), category: oneOf(x.category, CATEGORIES, "category"), status, submittedAt: optIso(x.submitted_at, "submitted_at"), decidedAt: optIso(x.decided_at, "decided_at"), reason: status === "needs_change" ? (reason ?? { code: "other", params: {} }) : null };
}

/** `GET .../own-templates`: `{items: [...]}`, at most 100; a row the web cannot read is left out (never the whole list). */
export function parseOwnMessages(json: unknown): OwnMessage[] {
  const rows = list(rec(json, "own messages").items, "items", 100);
  const out: OwnMessage[] = [];
  for (const row of rows) {
    try {
      out.push(parseOwnMessage(row));
    } catch {
      // one unreadable row does not hide the others
    }
  }
  return out;
}
