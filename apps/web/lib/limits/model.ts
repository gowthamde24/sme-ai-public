import type { OutboxSettings } from "@/lib/api/outbox";
import type { PolicyVersion } from "@/lib/api/followups";
import type { QuotePolicyVersion } from "@/lib/api/quote-policies";
import type { AutoReply } from "@/lib/auto-reply/types";

/**
 * Settings > Limits (app v4 part 8, owner 9 Nov 2026): what the assistant may do alone, and what always needs the owner's OK. Read-only. "Always needs your OK" is built in and cannot be switched off, so it is fixed text. "It may do alone" is
 * read from the real settings (the outbox's, the auto-reply's, the quote policy in force and the follow-up policy), never from policy prose; a setting that cannot be read is `null` and the page says "Not shown yet": nothing is guessed.
 */
export type Fact = { key: string; vars: Record<string, string>; /** null = could not be read */ ok: boolean };
export type Limits = { alone: Fact[]; quiet: Fact | null };

/** 21 -> "9 pm", 9 -> "9 am" (India time, as the API's hours are). */
export const hourWords = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 || h === 24 ? "am" : "pm"}`;
const pct = (bps: number): string => String(Math.round(bps) / 100);

export type Inputs = { outbox: OutboxSettings | null; autoReply: AutoReply | null; quote: QuotePolicyVersion | null; followup: PolicyVersion | null };

/** The newest version that has taken effect (the one in force); null when there is none yet. */
export function inForce<T extends { effective_from: string; version_no: number }>(versions: readonly T[] | null, now: number): T | null {
  if (!versions) return null;
  return versions.filter((v) => Date.parse(v.effective_from) <= now).sort((a, b) => b.version_no - a.version_no)[0] ?? null;
}

export function buildLimits(i: Inputs): Limits {
  const unread = (key: string): Fact => ({ key, vars: {}, ok: false });
  const alone: Fact[] = [
    i.outbox ? { key: i.outbox.auto_send_enabled ? "lim.send.auto.on" : "lim.send.auto.off", vars: {}, ok: true } : unread("lim.send.auto"),
    i.outbox ? { key: "lim.send.daily", vars: { n: String(i.outbox.per_customer_daily_limit) }, ok: true } : unread("lim.send.daily"),
    i.outbox ? { key: i.outbox.platform_switch_on ? "lim.send.master.on" : "lim.send.master.off", vars: {}, ok: true } : unread("lim.send.master"),
    i.autoReply ? { key: i.autoReply.enabled ? "lim.reply.on" : "lim.reply.off", vars: {}, ok: true } : unread("lim.reply"),
    i.quote ? { key: "lim.quote.ceiling", vars: { pct: pct(i.quote.discount_ceiling_bps), days: String(i.quote.validity_days) }, ok: true } : unread("lim.quote"),
    i.followup ? { key: "lim.follow.max", vars: { n: String(i.followup.max_touches), from: i.followup.quiet_start.slice(0, 5), to: i.followup.quiet_end.slice(0, 5) }, ok: true } : unread("lim.follow"),
  ];
  const quiet: Fact | null = i.outbox ? { key: "lim.quiet", vars: { from: hourWords(i.outbox.quiet_hours_start), to: hourWords(i.outbox.quiet_hours_end) }, ok: true } : null;
  return { alone, quiet };
}

/** The things that always need the owner's OK: built in, cannot be switched off (a fixed list of word keys). */
export const ALWAYS = ["lim.always.money", "lim.always.complaint", "lim.always.promise", "lim.always.unsure"] as const;
