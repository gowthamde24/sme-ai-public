import { CALL_LANG_NAMES } from "@/lib/assistant/types";

import { GOALS, SOURCE_TAGS } from "./types";

/** The names of the closed word lists in the person's language, taken from the page's words (`ld.goal.*`, `ld.source.*`); a missing word falls back to the plain code. Pure. */
export const goalNames = (words: Readonly<Record<string, string>>): Record<string, string> => Object.fromEntries(GOALS.map((g) => [g, words[`ld.goal.${g}`] ?? g]));
export const sourceNames = (words: Readonly<Record<string, string>>): Record<string, string> => Object.fromEntries(SOURCE_TAGS.map((s) => [s, words[`ld.source.${s}`] ?? s]));
export const languageNames = (): Record<string, string> => ({ ...CALL_LANG_NAMES });
export const channelNames = (words: Readonly<Record<string, string>>): Record<string, string> => ({ call: words["pc.channel.call"] ?? "call", whatsapp: words["pc.channel.whatsapp"] ?? "whatsapp", both: words["pc.channel.both"] ?? "both" });

/** Minutes after midnight as "09:30". */
export const clockText = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** Seconds as "1 min 36 s" (or "45 s"): words come from the page's own dictionary. */
export function durationText(seconds: number | null, words: Readonly<Record<string, string>>): string {
  if (seconds === null) return words["ld.report.none"] ?? "-";
  if (seconds < 60) return (words["ld.report.sec"] ?? "{s} s").replace("{s}", String(seconds));
  return (words["ld.report.minsec"] ?? "{m} min {s} s").replace("{m}", String(Math.floor(seconds / 60))).replace("{s}", String(seconds % 60));
}

