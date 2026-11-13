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
