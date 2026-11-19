import { planName } from "./names";

/**
 * The two plan TIERS (owner decision 4 Nov 2026): the tier id `ai_workforce` has every feature, `lead_desk` has every feature except the Lead Finder ("Find customers"). Both are API ids, never shown: since the owner's decision of 19 Nov the
 * owner sees plan names only (Pay as you go / Pro / Business, lib/plan/names.ts), and a tier whose plan has no such name is shown by what it has (TIER_NAMES). A tier is what a workspace's plan INCLUDES, not a billing plan: the tier ids below are
 * never plan ids (packages/plans/plans.json; scripts/plans_check.py keeps plan ids out of code, and tier.test.ts proves the two sets never meet). C1's draft (docs/contracts/plans-billing.md, "Plans as feature switches") calls a
 * tier a `product`. Pure: no request, so the browser parts (the plan badge, the upgrade card) can use the names too. The reader is lib/plan/tier-source.ts.
 */
export const TIERS = ["ai_workforce", "lead_desk"] as const;
export type Tier = (typeof TIERS)[number];

/** What a tier is called when its plan has no owner-facing name (lib/plan/names.ts): by what it has, the same in every language. */
export const TIER_NAMES: Record<Tier, string> = { ai_workforce: "With Find customers", lead_desk: "Without Find customers" };

/** What a workspace's tier switches on. `name`: the owner-facing name of the plan (lib/plan/names.ts; the API's `product_name` is NOT shown), null = TIER_NAMES. `upgradeTo`: the tier that has what is off here (the upgrade card), null on `ai_workforce`. */
export type Entitlements = { tier: Tier; name: string | null; features: { leadFinder: boolean }; upgradeTo: Tier | null };

/** Every feature: what the web assumes when the flag is off or the API gives no answer it can read (nothing is hidden by accident). */
export const ALL_IN: Entitlements = { tier: "ai_workforce", name: null, features: { leadFinder: true }, upgradeTo: null };
export const LEAD_DESK: Entitlements = { tier: "lead_desk", name: null, features: { leadFinder: false }, upgradeTo: "ai_workforce" };
/** The badge's words: the plan's owner-facing name, else the tier's. */
export const tierName = (e: Pick<Entitlements, "tier" | "name">): string => e.name ?? TIER_NAMES[e.tier];

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);

/**
 * The API's answer, or null when it is not one the screens can trust (the caller then treats the workspace as having every feature). C1's contract (#317, docs/contracts/plans-billing.md "Plans as feature switches"):
 * `{plan, product, product_name: {en}, features: {lead_desk, lead_finder}, upgrade: {product, product_name, features} | null}`. `plan` is a billing plan id: it is read only to find the owner-facing plan name (lib/plan/names.ts); `product_name` is not shown. The shorter `{tier, features: {lead_finder}, upgrade_to}`
 * C2 proposed first is read too (harmless).
 */
export function parseEntitlements(json: unknown): Entitlements | null {
  if (!isRec(json) || !isRec(json.features)) return null;
  const tier = json.product ?? json.tier;
  const leadFinder = json.features.lead_finder;
  if (!isTier(tier) || typeof leadFinder !== "boolean") return null;
  const up = isRec(json.upgrade) ? json.upgrade.product : json.upgrade === null || json.upgrade === undefined ? (json.upgrade_to ?? null) : undefined;
  if (up !== null && !isTier(up)) return null;
  const name = planName(typeof json.plan === "string" ? json.plan : null);
  return { tier, name, features: { leadFinder }, upgradeTo: up === tier ? null : up };
}

/** The fixture of PLAN_TIER_SCREENS=mock: every feature, or without Find customers with PLAN_TIER_MOCK=lead_desk. */
export const mockEntitlements = (value: string | undefined = process.env.PLAN_TIER_MOCK): Entitlements => (value === "lead_desk" ? LEAD_DESK : ALL_IN);

/** The features a tier's "What's included" list names, in order. `finder` is the Lead Finder ("Find customers"; only where the plan has it); `quotes` only for a business that makes quotes. */
export const INCLUDED = ["leads", "followups", "quotes", "assistant", "reports", "finder"] as const;
export type Included = (typeof INCLUDED)[number];
