/**
 * The two plan TIERS (owner decision 4 Nov 2026): **AI Workforce** has every feature, **Lead Desk** has every feature except the Lead Finder. A tier is what a workspace's plan INCLUDES, not a billing plan: the tier ids below are
 * never plan ids (packages/plans/plans.json; scripts/plans_check.py keeps plan ids out of code, and tier.test.ts proves the two sets never meet). C1's draft (docs/contracts/plans-billing.md, "Plans as feature switches") calls a
 * tier a `product`. Pure: no request, so the browser parts (the plan badge, the upgrade card) can use the names too. The reader is lib/plan/tier-source.ts.
 */
export const TIERS = ["ai_workforce", "lead_desk"] as const;
export type Tier = (typeof TIERS)[number];

/** Tier names are names (like plan names and the product's own name): the same in every language. */
export const TIER_NAMES: Record<Tier, string> = { ai_workforce: "AI Workforce", lead_desk: "Lead Desk" };

/** What a workspace's tier switches on. `name`: the API's `product_name` (the plan badge), null = the web's own (TIER_NAMES). `upgradeTo`: the tier that has what is off here (the upgrade card), null on AI Workforce. */
export type Entitlements = { tier: Tier; name: string | null; features: { leadFinder: boolean }; upgradeTo: Tier | null };

/** Every feature: what the web assumes when the flag is off or the API gives no answer it can read (nothing is hidden by accident). */
export const ALL_IN: Entitlements = { tier: "ai_workforce", name: null, features: { leadFinder: true }, upgradeTo: null };
export const LEAD_DESK: Entitlements = { tier: "lead_desk", name: null, features: { leadFinder: false }, upgradeTo: "ai_workforce" };
/** The badge's words: the API's product name, else the web's. */
export const tierName = (e: Pick<Entitlements, "tier" | "name">): string => e.name ?? TIER_NAMES[e.tier];

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);

/**
 * The API's answer, or null when it is not one the screens can trust (the caller then treats the workspace as AI Workforce). C1's contract (#317, docs/contracts/plans-billing.md "Plans as feature switches"):
 * `{plan, product, product_name: {en}, features: {lead_desk, lead_finder}, upgrade: {product, product_name, features} | null}`. `plan` is a billing plan id and is never read here. The shorter `{tier, features: {lead_finder}, upgrade_to}`
 * C2 proposed first is read too (harmless).
 */
export function parseEntitlements(json: unknown): Entitlements | null {
  if (!isRec(json) || !isRec(json.features)) return null;
  const tier = json.product ?? json.tier;
  const leadFinder = json.features.lead_finder;
  if (!isTier(tier) || typeof leadFinder !== "boolean") return null;
  const up = isRec(json.upgrade) ? json.upgrade.product : json.upgrade === null || json.upgrade === undefined ? (json.upgrade_to ?? null) : undefined;
  if (up !== null && !isTier(up)) return null;
  const names = isRec(json.product_name) ? json.product_name : null;
  const name = names && typeof names.en === "string" && names.en.trim() !== "" && names.en.length <= 40 ? names.en.trim() : null;
  return { tier, name, features: { leadFinder }, upgradeTo: up === tier ? null : up };
}

/** The fixture of PLAN_TIER_SCREENS=mock: AI Workforce, or Lead Desk with PLAN_TIER_MOCK=lead_desk. */
export const mockEntitlements = (value: string | undefined = process.env.PLAN_TIER_MOCK): Entitlements => (value === "lead_desk" ? LEAD_DESK : ALL_IN);

/** The features a tier's "What's included" list names, in order. `finder` is the Lead Finder (AI Workforce only); `quotes` only for a business that makes quotes. */
export const INCLUDED = ["leads", "followups", "quotes", "assistant", "reports", "finder"] as const;
export type Included = (typeof INCLUDED)[number];
