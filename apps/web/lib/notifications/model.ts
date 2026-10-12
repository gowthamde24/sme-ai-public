/**
 * The notifications centre (job BU): what the bell shows and how "new" is decided on one device. Pure functions, no React, no request.
 *
 * A notice is a thing a person may want to act on, made from data the app already reads (Today's "needs you", the visits of today, the blocked part of the Outbox): nothing is stored on the server for it.
 * `id` is stable across reads (the item's own id), so the same waiting message is the same notice every minute. "Unread" is per DEVICE: the ids this browser has already shown the person are kept in its own
 * storage (key `sme-notify-seen`), so nothing is shared, nothing is sent, and a second phone starts with everything unread.
 */
export const NOTICE_KINDS = ["needs_you", "visit", "blocked"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** `code` is a closed word the bell has a sentence for; `who` is the customer's name when there is one (it is shown in the panel, never in a browser notification). */
export const NOTICE_CODES = ["quote_approval", "followup_due", "order_money_held", "outbox_approval", "call_approval", "visit_proposed", "visit_here", "message_blocked"] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];

export interface Notice {
  id: string;
  kind: NoticeKind;
  code: NoticeCode;
  who: string;
  /** ISO 8601 */
  at: string;
  /** A path inside the workspace (/app/tenants/<id>/...). */
  href: string;
}

export const MAX_NOTICES = 20;
export const MAX_SEEN = 300;

const KIND_OF: Record<NoticeCode, NoticeKind> = {
  quote_approval: "needs_you",
  followup_due: "needs_you",
  order_money_held: "needs_you",
  outbox_approval: "needs_you",
  call_approval: "needs_you",
  visit_proposed: "needs_you",
  visit_here: "visit",
  message_blocked: "blocked",
};
export const kindOf = (code: NoticeCode): NoticeKind => KIND_OF[code];

/** The server's answer, checked: anything that is not a notice of ours is dropped, a path that leaves the workspace is dropped, and there are at most MAX_NOTICES, newest first. */
export function parseNotices(json: unknown, base: string): Notice[] {
  if (typeof json !== "object" || json === null || !Array.isArray((json as { items?: unknown }).items)) return [];
  const out: Notice[] = [];
  for (const raw of (json as { items: unknown[] }).items) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const code = r.code as NoticeCode;
    if (typeof r.id !== "string" || r.id.length === 0 || r.id.length > 120) continue;
    if (!(NOTICE_CODES as readonly string[]).includes(code)) continue;
    if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) continue;
    if (typeof r.href !== "string" || !(r.href === base || r.href.startsWith(`${base}/`) || r.href.startsWith(`${base}#`) || r.href.startsWith(`${base}?`))) continue;
    if (/[\\\u0000-\u001f]/.test(r.href)) continue;
    out.push({ id: r.id, kind: kindOf(code), code, who: typeof r.who === "string" ? r.who.slice(0, 120) : "", at: r.at, href: r.href });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX_NOTICES);
}

export function parseSeen(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-MAX_SEEN) : [];
  } catch {
    return [];
  }
}

export const unreadOf = (items: readonly Notice[], seen: readonly string[]): Notice[] => items.filter((n) => !seen.includes(n.id));
export const unreadCount = (items: readonly Notice[], seen: readonly string[]): number => unreadOf(items, seen).length;

/** The ids seen so far plus everything shown now; ids that are no longer around fall off the front, so the list never grows without bound. */
export function markAllSeen(items: readonly Notice[], seen: readonly string[]): string[] {
  const next = [...seen.filter((id) => !items.some((n) => n.id === id)), ...items.map((n) => n.id)];
  return next.slice(-MAX_SEEN);
}

/** What a browser notification may be told about: only a "needs you" notice that this browser has not announced yet. */
export const toAnnounce = (items: readonly Notice[], announced: readonly string[]): Notice[] => items.filter((n) => n.kind === "needs_you" && !announced.includes(n.id));
