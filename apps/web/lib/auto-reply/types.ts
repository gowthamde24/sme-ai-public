/**
 * The assistant's automatic WhatsApp replies (job DY, C1's `GET/PUT /v1/tenants/{id}/ai-assistant/auto-reply`): ONE switch, owned by the Owner (the change needs the second factor and is audited). `rules` are fixed WORDS the screen shows next to the switch in its own
 * sentences; today's counts say what the assistant did and what is waiting for the owner. Anything the API sends beyond this is ignored.
 */
export const RULES = ["answers_within_24_hours", "asks_you_before_prices_and_promises", "hands_over_when_unsure_or_asked_for_a_person"] as const;
export type Rule = (typeof RULES)[number];
export type AutoReply = { enabled: boolean; changedAt: string | null; answeredToday: number; heldToday: number; dailyLimit: number; rules: Rule[] };
export type AutoReplyError = "mfa" | "forbidden" | "not_available" | "down";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.trunc(v), 1_000_000) : 0);
export function parseAutoReply(json: unknown): AutoReply | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  if (typeof j.enabled !== "boolean") return null;
  return { enabled: j.enabled, changedAt: typeof j.changed_at === "string" ? j.changed_at.slice(0, 40) : null, answeredToday: num(j.answered_today), heldToday: num(j.held_today), dailyLimit: num(j.daily_limit), rules: Array.isArray(j.rules) ? j.rules.filter((r): r is Rule => (RULES as readonly unknown[]).includes(r)) : [] };
}
