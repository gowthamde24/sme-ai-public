/**
 * The lead-source cards (job context-and-easy-sources part B, contract-context-sources.md): `GET /lead-sources/cards` always in this order, each with a live status, ONE action and, when something is wrong, a problem in plain words with a one-tap fix. The card's own sentences
 * (headline, detail, problem) come from the API in plain words and are shown as they are; the card's title and the buttons are this app's own words, in the person's language. Keys are never read back: only a hint ("...a1b2").
 */
export const CARD_KINDS = ["meta", "indiamart", "email_forward", "website", "files", "whatsapp", "missed_calls"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
export const STATUSES = ["not_connected", "connected", "needs_attention", "coming_soon"] as const;
export type CardStatus = (typeof STATUSES)[number];
export const ACTIONS = ["oauth", "paste_key", "copy_address", "copy_snippet", "upload", "resume", "open", "none"] as const;
export type CardAction = (typeof ACTIONS)[number];

export type Card = { kind: CardKind; status: CardStatus; headline: string; detail: string | null; received7d: number; lastReceivedAt: string | null; action: CardAction; problem: { message: string; fix: CardAction } | null; available: boolean };
export type MetaPage = { id: string; name: string; selected: boolean };
export type EmailAddress = { address: string; guide: { step: number; text: string }[]; portals: string[]; confirmation: { code: string; receivedAt: string | null } | null };
export type WebsiteSnippet = { snippet: string; formLink: string | null };
/** The closed words a refusal becomes. */
export type SourceError = "badkey" | "notavailable" | "state" | "forbidden" | "slow" | "down";
export type Done<T> = { ok: true; data: T } | { ok: false; error: SourceError };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);
const action = (v: unknown): CardAction => ((ACTIONS as readonly unknown[]).includes(v) ? (v as CardAction) : "none");

export function parseCards(json: unknown): Card[] | null {
  if (!isRec(json) || !Array.isArray(json.items)) return null;
  const out: Card[] = [];
  for (const raw of json.items.slice(0, 20)) {
    if (!isRec(raw) || !(CARD_KINDS as readonly unknown[]).includes(raw.kind) || !(STATUSES as readonly unknown[]).includes(raw.status)) continue; // a card this app does not know is left out
    const problem = isRec(raw.problem) && s(raw.problem.message, 300) ? { message: s(raw.problem.message, 300) as string, fix: action(isRec(raw.problem.fix) ? raw.problem.fix.type : null) } : null;
    out.push({ kind: raw.kind as CardKind, status: raw.status as CardStatus, headline: s(raw.headline, 120) ?? "", detail: s(raw.detail, 200), received7d: typeof raw.received_7d === "number" && raw.received_7d >= 0 ? Math.trunc(raw.received_7d) : 0, lastReceivedAt: s(raw.last_received_at, 40), action: isRec(raw.action) ? action(raw.action.type) : "none", problem, available: raw.available !== false });
  }
  return out;
}
export function parsePages(json: unknown): MetaPage[] | null {
  if (!isRec(json) || !Array.isArray(json.items)) return null;
  return json.items.filter(isRec).slice(0, 50).flatMap((p) => (typeof p.id === "string" && typeof p.name === "string" ? [{ id: p.id.slice(0, 64), name: p.name.slice(0, 120), selected: p.selected === true }] : []));
}
export function parseAuthorize(json: unknown): string | null {
  if (!isRec(json) || typeof json.authorize_url !== "string") return null;
  try {
    const u = new URL(json.authorize_url);
    return u.protocol === "https:" ? u.toString() : null; // only a secure address is ever opened
  } catch {
    return null;
  }
}
export function parseKeyResult(json: unknown): { status: "connected" | "needs_attention"; hint: string } | null {
  return isRec(json) && (json.status === "connected" || json.status === "needs_attention") ? { status: json.status, hint: s(json.key_hint, 20) ?? "" } : null;
}
export function parseEmail(json: unknown): EmailAddress | null {
  if (!isRec(json) || !s(json.address, 200)) return null;
  const guide = Array.isArray(json.gmail_filter_guide) ? json.gmail_filter_guide.filter(isRec).slice(0, 10).flatMap((g, i) => (s(g.text, 300) ? [{ step: typeof g.step === "number" ? g.step : i + 1, text: s(g.text, 300) as string }] : [])) : [];
  return { address: s(json.address, 200) as string, guide, portals: Array.isArray(json.sample_portals) ? json.sample_portals.filter((x): x is string => typeof x === "string").slice(0, 8) : [], confirmation: isRec(json.gmail_confirmation) && s(json.gmail_confirmation.code, 40) ? { code: s(json.gmail_confirmation.code, 40) as string, receivedAt: s(json.gmail_confirmation.received_at, 40) } : null };
}
export function parseWebsite(json: unknown): WebsiteSnippet | null {
  return isRec(json) && s(json.snippet, 4000) ? { snippet: s(json.snippet, 4000) as string, formLink: s(json.form_link, 500) } : null;
}
