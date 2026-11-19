/**
 * THE AUTOMATIC CHECKS of the own-message builder (JOBS; owner decision 19 Nov 2026: "automatic checks against Meta's rules with a one-tap Fix"). PURE: text in, results out, no network, no clock, no words of ours.
 * A result is a closed CODE with a status (ok or warn), the KEY of the plain sentence that says it (`jobs.tb.check.*`, the web holds the words in four languages) with its numbers, and the CODE of the one-tap fix (or null when only the owner can change it,
 * by saying it). `applyFix` and `fixAll` are the fixes as plain text transforms. The rules are the ones WhatsApp refuses a message for (C1 maps WhatsApp's own refusals to the reason codes in lib/api/template-builder.ts); a message that passes every check can still be
 * refused, and then the reason comes back in plain words ("Needs a change").
 *
 * A customer's name is the token `{name}` inside the text (never `{{1}}`, never shown: the screen draws a plain "Name" chip, the preview the sample first name). The wire form of the variable is C1's.
 */
export const DRAFT_LANGS = ["te", "en"] as const;
export type DraftLang = (typeof DRAFT_LANGS)[number];
export const CATEGORIES = ["utility", "marketing"] as const;
export type Category = (typeof CATEGORIES)[number];

/** What WhatsApp shows: a title (optional), the message, a small line at the bottom (optional) and up to three quick-reply buttons. */
export type Draft = { header: string | null; body: string; footer: string | null; buttons: readonly string[] };
export type Message = { category: Category; drafts: Readonly<Record<DraftLang, Draft>> };

export const NAME_TOKEN = "{name}";
/** WhatsApp's own limits (characters), as the checks use them. */
export const LIMITS = { header: 60, body: 1024, footer: 60, button: 25, buttons: 3, emoji: 3 } as const;

export const CHECK_CODES = ["category", "price_promise", "capitals", "name_edge", "length", "emoji", "opt_out", "buttons", "same_in_both"] as const;
export type CheckCode = (typeof CHECK_CODES)[number];
export const FIX_CODES = ["to_marketing", "remove_price_words", "lowercase_caps", "greet_first", "close_last", "trim_emoji", "add_opt_out"] as const;
export type FixCode = (typeof FIX_CODES)[number];

export type CheckParams = Readonly<Record<string, string | number>>;
export type CheckResult = {
  code: CheckCode;
  status: "ok" | "warn";
  /** The string key of the plain sentence (`jobs.tb.check.<code>.<ok|warn>[_variant]`) and the numbers and words it takes. */
  key: string;
  params: CheckParams;
  /** Which languages the warning is about (empty when ok). */
  langs: readonly DraftLang[];
  fix: FixCode | null;
};

const len = (s: string): number => [...s].length;
const texts = (d: Draft): string[] => [d.header ?? "", d.body, d.footer ?? "", ...d.buttons];
const bodyAndHeader = (d: Draft): string => `${d.header ?? ""}\n${d.body}`;

/* ---- the words each rule looks for ---- */
/** Money and promises that WhatsApp does not allow in an order-update (utility) message. Latin words are whole words; the Telugu ones are the way shops say them. */
const PRICE_WORDS = /(?:₹\s?\d[\d,.]*|\bRs\.?\s?\d[\d,.]*|\bINR\s?\d[\d,.]*|\d+\s?%(?:\s?off)?|\b(?:discount|discounts|offer|offers|sale|free|cashback|cheap|cheaper|lowest price|best price|coupon)\b|తగ్గింపు|డిస్కౌంట్|ఆఫర్|ఉచితం|ఫ్రీ|సేల్)/giu;
/** Words that make a message an invitation to buy (a promotion) even without a price. */
const PROMO_WORDS = /\b(?:new collection|new arrivals?|limited time|hurry|shop now|buy now|festival special|don'?t miss|grand opening|exclusive)\b|కొత్త కలెక్షన్|త్వరపడండి/iu;
/** Short capital words that are fine (they are written that way). */
const CAPS_OK = new Set(["STOP", "YES", "NO", "OK", "UPI", "OTP", "GST", "GSTIN", "PAN", "EMI", "COD", "QR", "SMS", "PIN", "ID", "AM", "PM", "AI"]);
const OPT_OUT = /\bSTOP\b|opt[\s-]?out|unsubscribe|ఆపండి|ఆపాలంటే|నిలిపివేయ|रोकें/iu;
const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

/** The lines the two fixes add. */
export const GREETING: Record<DraftLang, string> = { te: "నమస్కారం", en: "Hello" };
export const CLOSING: Record<DraftLang, string> = { te: "ధన్యవాదాలు.", en: "Thank you." };
export const OPT_OUT_LINE: Record<DraftLang, string> = { te: "ఆపాలంటే STOP అని రిప్లై చేయండి", en: "Reply STOP to opt out" };

const priceWords = (text: string): string[] => [...text.matchAll(PRICE_WORDS)].map((m) => m[0].trim());
function shouted(text: string): string[] {
  return [...text.matchAll(/\b[A-Z]{3,}\b/g)].map((m) => m[0]).filter((w) => !CAPS_OK.has(w));
}
const emojiOf = (text: string): string[] => text.match(EMOJI) ?? [];
const startsWithName = (body: string): boolean => body.trimStart().startsWith(NAME_TOKEN);
const endsWithName = (body: string): boolean => body.trimEnd().endsWith(NAME_TOKEN);
export const nameCount = (text: string): number => text.split(NAME_TOKEN).length - 1;

type Hit = { langs: DraftLang[]; params?: CheckParams };
const hits = (m: Message, test: (d: Draft, lang: DraftLang) => CheckParams | null): Hit | null => {
  const found: DraftLang[] = [];
  let params: CheckParams | undefined;
  for (const lang of DRAFT_LANGS) {
    const p = test(m.drafts[lang], lang);
    if (p) {
      found.push(lang);
      params ??= { ...p, lang };
    }
  }
  return found.length > 0 ? { langs: found, params } : null;
};

const result = (code: CheckCode, status: "ok" | "warn", variant: string, params: CheckParams, langs: readonly DraftLang[], fix: FixCode | null): CheckResult => ({ code, status, key: `jobs.tb.check.${code}.${status}${variant ? `_${variant}` : ""}`, params, langs, fix });

/** Every check, in the order the screen lists them (a warning first on screen is the screen's choice). One result per code. */
export function runChecks(m: Message): CheckResult[] {
  const out: CheckResult[] = [];

  // the group it goes in: a promotion written as an order update is refused
  const promo = m.category === "utility" ? hits(m, (d) => (PROMO_WORDS.test(bodyAndHeader(d)) ? {} : null)) : null;
  out.push(promo ? result("category", "warn", "", { category: m.category }, promo.langs, "to_marketing") : result("category", "ok", m.category, { category: m.category }, [], null));

  const price = m.category === "utility" ? hits(m, (d) => { const w = priceWords(bodyAndHeader(d)); return w.length > 0 ? { word: w[0] } : null; }) : null;
  out.push(price ? result("price_promise", "warn", "", price.params ?? {}, price.langs, "remove_price_words") : result("price_promise", "ok", m.category === "marketing" ? "marketing" : "", {}, [], null));

  const caps = hits(m, (d) => { const w = shouted(bodyAndHeader(d)); return w.length > 0 ? { word: w[0], to: w[0].toLowerCase() } : null; });
  out.push(caps ? result("capitals", "warn", "", caps.params ?? {}, caps.langs, "lowercase_caps") : result("capitals", "ok", "", {}, [], null));

  const startHit = hits(m, (d) => (startsWithName(d.body) ? {} : null));
  const endHit = hits(m, (d) => (endsWithName(d.body) ? {} : null));
  if (startHit) out.push(result("name_edge", "warn", "start", { ...(startHit.params ?? {}), greeting: GREETING[startHit.langs[0]] }, startHit.langs, "greet_first"));
  else if (endHit) out.push(result("name_edge", "warn", "end", endHit.params ?? {}, endHit.langs, "close_last"));
  else out.push(result("name_edge", "ok", "", {}, [], null));

  const tooLong = hits(m, (d) => {
    const parts: [string, string, number][] = [["header", d.header ?? "", LIMITS.header], ["body", d.body, LIMITS.body], ["footer", d.footer ?? "", LIMITS.footer]];
    const over = parts.find(([, text, max]) => len(text) > max);
    return over ? { part: over[0], n: len(over[1]), max: over[2] } : null;
  });
  out.push(tooLong ? result("length", "warn", "", tooLong.params ?? {}, tooLong.langs, null) : result("length", "ok", "", {}, [], null));

  const spam = hits(m, (d) => {
    const all = emojiOf(texts(d).join(" "));
    const run = /(\p{Extended_Pictographic})\1\1/u.test(d.body);
    return all.length > LIMITS.emoji || run ? { n: all.length, max: LIMITS.emoji } : null;
  });
  out.push(spam ? result("emoji", "warn", "", spam.params ?? {}, spam.langs, "trim_emoji") : result("emoji", "ok", "", {}, [], null));

  // a promotion must say how to stop it (the STOP line); an order update need not
  if (m.category === "marketing") {
    const missing = hits(m, (d) => (OPT_OUT.test(texts(d).join("\n")) ? null : {}));
    out.push(missing ? result("opt_out", "warn", "", {}, missing.langs, "add_opt_out") : result("opt_out", "ok", "", {}, [], null));
  } else out.push(result("opt_out", "ok", "not_needed", {}, [], null));

  const tooMany = hits(m, (d): CheckParams | null => {
    const long = d.buttons.find((b) => len(b) > LIMITS.button);
    if (long !== undefined) return { text: long, max: LIMITS.button };
    return d.buttons.length > LIMITS.buttons ? { n: d.buttons.length, max: LIMITS.buttons } : null;
  });
  const longButton = tooMany?.params && "text" in tooMany.params;
  out.push(tooMany ? result("buttons", "warn", longButton ? "long" : "many", tooMany.params ?? {}, tooMany.langs, null) : result("buttons", "ok", "", { a: m.drafts.te.buttons[0] ?? "", b: m.drafts.en.buttons[0] ?? "" }, [], null));

  const empty = DRAFT_LANGS.find((l) => m.drafts[l].body.trim() === "");
  const sameNames = nameCount(m.drafts.te.body) === nameCount(m.drafts.en.body);
  if (empty) out.push(result("same_in_both", "warn", "empty", { lang: empty }, [empty], null));
  else if (!sameNames) out.push(result("same_in_both", "warn", "name", {}, [...DRAFT_LANGS], null));
  else out.push(result("same_in_both", "ok", "", {}, [], null));
  return out;
}

export const warnings = (rs: readonly CheckResult[]): CheckResult[] => rs.filter((r) => r.status === "warn");
/** The message may go to WhatsApp only when every check is ok: each warning is something WhatsApp refuses a message for. */
export const canSend = (m: Message): boolean => warnings(runChecks(m)).length === 0 && DRAFT_LANGS.every((l) => m.drafts[l].body.trim() !== "");

/* ---- the fixes: plain text transforms ---- */
const tidy = (s: string): string => s.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").replace(/\(\s*\)/g, "").replace(/^[ \t]+|[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
const mapDrafts = (m: Message, f: (d: Draft, lang: DraftLang) => Draft): Message => ({ ...m, drafts: { te: f(m.drafts.te, "te"), en: f(m.drafts.en, "en") } });
const mapText = (d: Draft, f: (s: string) => string): Draft => ({ ...d, header: d.header === null ? null : f(d.header), body: f(d.body), footer: d.footer === null ? null : f(d.footer) });

function lowerShouts(text: string): string {
  return text.replace(/\b[A-Z]{3,}\b/g, (w, at: number) => {
    if (CAPS_OK.has(w)) return w;
    const lower = w.toLowerCase();
    // a word that starts a sentence keeps its first capital letter
    const before = text.slice(0, at).trimEnd();
    return before === "" || /[.!?\n]$/.test(before) ? lower[0].toUpperCase() + lower.slice(1) : lower;
  });
}
function keepTwoEmoji(text: string): string {
  let n = 0;
  return tidy(text.replace(EMOJI, (e) => (++n <= 2 ? e : "")));
}

export function applyFix(m: Message, fix: FixCode): Message {
  switch (fix) {
    case "to_marketing":
      return { ...m, category: "marketing" };
    case "remove_price_words":
      return mapDrafts(m, (d) => mapText(d, (s) => tidy(s.replace(PRICE_WORDS, ""))));
    case "lowercase_caps":
      return mapDrafts(m, (d) => mapText(d, lowerShouts));
    case "greet_first":
      return mapDrafts(m, (d, l) => (startsWithName(d.body) ? { ...d, body: `${GREETING[l]} ${d.body.trimStart()}` } : d));
    case "close_last":
      return mapDrafts(m, (d, l) => (endsWithName(d.body) ? { ...d, body: `${d.body.trimEnd()}${/[.!?]$/.test(d.body.trimEnd()) ? "" : "."} ${CLOSING[l]}` } : d));
    case "trim_emoji":
      return mapDrafts(m, (d) => ({ ...mapText(d, keepTwoEmoji), buttons: d.buttons.map(keepTwoEmoji) }));
    case "add_opt_out":
      return mapDrafts(m, (d, l) => (OPT_OUT.test(texts(d).join("\n")) ? d : { ...d, footer: d.footer && d.footer.trim() !== "" ? `${d.footer} · ${OPT_OUT_LINE[l]}` : OPT_OUT_LINE[l] }));
  }
}

/** "Fix all": every fixable warning, one after another (one fix can bring up another check, for example an offer becoming a promotion needs its STOP line); stops when nothing fixable is left. */
export function fixAll(m: Message): Message {
  let now = m;
  for (let i = 0; i < 12; i++) {
    const next = warnings(runChecks(now)).find((r) => r.fix !== null);
    if (!next?.fix) return now;
    const after = applyFix(now, next.fix);
    if (JSON.stringify(after) === JSON.stringify(now)) return now;
    now = after;
  }
  return now;
}

/* ---- how a name is shown ---- */
export type NamePart = { kind: "text"; text: string } | { kind: "name" };
/** The text cut at every `{name}`: the screen draws the name parts as a chip. The braces never reach the screen. */
export function nameParts(text: string): NamePart[] {
  return text.split(NAME_TOKEN).flatMap((t, i): NamePart[] => (i === 0 ? (t ? [{ kind: "text", text: t }] : []) : [{ kind: "name" }, ...(t ? [{ kind: "text" as const, text: t }] : [])]));
}
/** The preview: the sample first name in place of the chip. */
export const fillName = (text: string, first: string): string => text.split(NAME_TOKEN).join(first);
/** The edit box shows the name as `[Name]` (no braces) and reads it back. */
export const EDIT_NAME = "[Name]";
export const toEditable = (text: string): string => text.split(NAME_TOKEN).join(EDIT_NAME);
export const fromEditable = (text: string): string => text.replace(/\[\s*name\s*\]/gi, "\u0000").replace(/[{}]/g, "").replace(/\u0000/g, NAME_TOKEN);
