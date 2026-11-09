import type { KindKey, LimitsOut } from "@/lib/api/limits";
import { formatRupeesShort } from "@/lib/money";

/**
 * Settings > Limits (app v4 part 8; read-only): what the assistant may do alone and what always needs the owner's OK, from the API's own `GET /limits` (lib/api/limits.ts), never from policy prose and never computed here. A locked kind is fixed
 * text ("always asks you") with no toggle; the numbers and hours are the settings the assistant really obeys; a call kind appears only once the assistant's settings were saved. Anything unreadable is "Not shown yet".
 */
export type Row = { key: string; vars: Record<string, string> };
export type Limits = {
  workspace: "on" | "off" | "platform_off";
  /** the kinds that always ask the owner (locked) */
  always: KindKey[];
  /** the kinds the owner's settings decide: alone, or it hands the matter to the owner */
  decided: { kind: KindKey; alone: boolean }[];
  caps: Row[];
  hours: Row[];
  assistantSaved: boolean;
};

/** 21 -> "9 pm", 9 -> "9 am" (India time, as the API's hours are). */
export const hourWords = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 || h === 24 ? "am" : "pm"}`;
/** 540 -> "9 am", 1140 -> "7 pm". */
export const minuteWords = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? hourWords(h) : `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, "0")} ${h < 12 || h === 24 ? "am" : "pm"}`;
};
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function buildLimits(l: LimitsOut): Limits {
  const caps: Row[] = l.caps.map((c) => ({
    key: `lim.cap.${c.key}`,
    vars: { n: c.value === null ? "" : c.key === "call_big_order_paise" ? formatRupeesShort(c.value) : c.value.toLocaleString("en-IN") },
  }));
  const hours: Row[] = [];
  if (l.messageHours) hours.push({ key: "lim.hours.messages", vars: { from: hourWords(l.messageHours.start), to: hourWords(l.messageHours.end) } });
  if (l.callHours) hours.push({ key: "lim.hours.calls", vars: { from: minuteWords(l.callHours.from), to: minuteWords(l.callHours.to), days: [...new Set(l.callHours.days)].sort((a, b) => a - b).map((d) => DAYS[d]).join(",") } });
  return {
    workspace: !l.platformOn ? "platform_off" : l.workspaceOn ? "on" : "off",
    always: l.kinds.filter((k) => k.locked && k.mode === "needs_ok").map((k) => k.kind),
    decided: l.kinds.filter((k) => !k.locked).map((k) => ({ kind: k.kind, alone: k.mode === "alone" })),
    caps,
    hours,
    assistantSaved: l.assistantSaved,
  };
}
