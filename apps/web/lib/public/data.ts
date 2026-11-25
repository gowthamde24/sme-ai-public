import { PLAN_FACTS, PUBLIC_PLANS, rupees } from "@/lib/site/plans";
import { ADDRESSES, RESPONSE_DAYS, RESPONSE_HOURS, RETENTION } from "@/lib/site/business";
import type { PubKey } from "@/i18n/public";

import talk from "./talk-types.json";

/**
 * The facts the launch public pages state (pricing, help, status, use policy, refunds, Talk to us). The words are in i18n/strings/public.json (`pub.*`); the numbers and addresses are read from here and from lib/site/plans.ts and
 * lib/site/business.ts, never typed into a string.
 *
 * FREE_START: the free credits on sign-up (planner decision 25 Nov 2026: Rs 100, about 20 minutes, one per verified phone or e-mail, no card). lib/site/plans.ts still holds the older Rs 50 of the early-access plan words; the
 * new pricing page and the help articles use this one.
 */
export const FREE_START = { rupees: 100, minutes: 20 } as const;

/** Unused credits can be refunded within this many days of the purchase (planner decision, 29 Nov 2026; the same number as the legal draft's 14-day window). */
export const REFUND_DAYS = 14;

export type HelpArticle = { slug: string; key: "setup" | "sell" | "number" | "sources" | "billing" | "rules" | "recording" | "delete" | "languages" | "contact"; /** The wording waits for the owner's approval (what the product tells people on a call): shown with the Draft tag. */ draft?: true };

/** The ten help articles, in the order of the help center. */
export const HELP_ARTICLES: readonly HelpArticle[] = [
  { slug: "set-up-your-assistant", key: "setup" },
  { slug: "add-what-you-sell", key: "sell" },
  { slug: "get-a-phone-number", key: "number" },
  { slug: "connect-lead-sources", key: "sources" },
  { slug: "billing-and-credits", key: "billing" },
  { slug: "calling-rules", key: "rules", draft: true },
  { slug: "call-recording", key: "recording", draft: true },
  { slug: "delete-your-data", key: "delete" },
  { slug: "languages", key: "languages" },
  { slug: "contact-us", key: "contact" },
];
export const articleBySlug = (slug: string): HelpArticle | null => HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
export const isArticleSlug = (slug: string): boolean => articleBySlug(slug) !== null;

export const articleKeys = (a: HelpArticle): { title: PubKey; summary: PubKey; body: PubKey[] } => ({
  title: `pub.help.${a.key}.t` as PubKey,
  summary: `pub.help.${a.key}.d` as PubKey,
  body: [1, 2, 3].map((n) => `pub.help.${a.key}.${n}` as PubKey),
});

/** The variables the public words take, as text. */
export function pubVars(): Record<string, string | number> {
  return {
    mail: ADDRESSES.hello,
    privacy: ADDRESSES.privacy,
    free: rupees(FREE_START.rupees),
    minutes: FREE_START.minutes,
    gst: PLAN_FACTS.gstPercent,
    minute: rupees(PLAN_FACTS.extraMinute),
    number: rupees(PLAN_FACTS.extraNumber),
    payg: rupees(PUBLIC_PLANS[0].monthly),
    cancel: RETENTION.deletionCancelDays,
    days: RESPONSE_DAYS.requests,
    hours: RESPONSE_HOURS.withdrawal,
    refund_days: REFUND_DAYS,
  };
}

/** The kinds of business in the Talk to us form (the top 15 of reports/business-type-catalogue.md, then "other"): data in talk-types.json, not code. */
export const TALK_TYPES = talk.types as readonly string[];
export type TalkType = string;
export const TALK_TIMES = ["morning", "afternoon", "evening"] as const;
export type TalkTime = (typeof TALK_TIMES)[number];

/**
 * The note area of the status page: an incident is written here by hand, newest first, with the time it started (ISO, India time) and whether it is fixed. An empty list draws "No problems reported". English only (written in a hurry, by a person).
 */
export type Incident = { started: string; title: string; text: string; fixed: boolean };
export const INCIDENTS: readonly Incident[] = [];
