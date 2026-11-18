/**
 * How the Chats page writes a person and a moment (approved mock): an avatar with the first letter of the name on one of six colours (picked from the name, so a person keeps theirs), and the time of the last message as the clock for today ("9:44"), "Yesterday", the weekday
 * for this week ("Mon") or the day ("3 Nov"). The day is the Indian day. Pure: the clock and the word for yesterday come in.
 */
export const AVATAR_COLOURS = 6;

export function avatarOf(name: string): { letter: string; colour: number } {
  const clean = name.trim();
  const letter = (Array.from(clean)[0] ?? "?").toUpperCase();
  let h = 0;
  for (const ch of clean.toLowerCase()) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return { letter, colour: h % AVATAR_COLOURS };
}

const day = (ms: number): number => Math.floor((ms + 5.5 * 3_600_000) / 86_400_000);
const fmt = (ms: number, o: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...o }).format(new Date(ms));

export function chatTime(iso: string, now: number, yesterday: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const diff = day(now) - day(at);
  if (diff <= 0) return fmt(at, { hour: "numeric", minute: "2-digit", hourCycle: "h23" }).replace(/^0/, "");
  if (diff === 1) return yesterday;
  if (diff < 7) return fmt(at, { weekday: "short" });
  return fmt(at, { day: "numeric", month: "short" });
}

/** WhatsApp's 24 hours end 24 hours after the customer's LAST message (owner, 18 Nov: the note must say when they closed). The latest incoming message of the loaded thread, plus 24 hours; with no incoming message loaded, the API's own `window_expires_at`; else null. */
export function windowClosedAt(items: readonly { direction: string; at: string }[], apiExpiresAt: string | null): string | null {
  let last = Number.NaN;
  for (const m of items) if (m.direction === "in") { const t = Date.parse(m.at); if (!Number.isNaN(t) && (Number.isNaN(last) || t > last)) last = t; }
  if (!Number.isNaN(last)) return new Date(last + 24 * 3_600_000).toISOString();
  return apiExpiresAt && !Number.isNaN(Date.parse(apiExpiresAt)) ? apiExpiresAt : null;
}

/** "17 Nov, 10:30 am" in India time: the day and the time of a moment (the 24-hour note). */
export function dayTime(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? "" : fmt(at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** A template's preview with its `{{1}}` / `{{name}}` fields filled from the values the API sent (by place, then by key); a field with no value shows as "…", never as braces (owner, 18 Nov). */
export function filledPreview(preview: string, variables: readonly { key: string; value: string | null }[]): string {
  return preview.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_m, f: string) => {
    const byPlace = /^\d+$/.test(f) ? variables[Number(f) - 1] : undefined;
    const v = byPlace ?? variables.find((x) => x.key === f);
    return v?.value ?? "…";
  });
}
