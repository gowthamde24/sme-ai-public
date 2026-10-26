import type { SiteKey } from "@/i18n/site";

/**
 * What the public pages say about Lead Desk (night 4, F1): the core of the product, on for every business (lead sources -> AI calls -> WhatsApp -> outcome -> follow-ups -> reports). The words are in i18n/strings/site.json
 * under `ld.*`; this file only lists which of them each block draws, so a block's list and its words cannot drift apart (a test reads both). No client code, no third-party logo: a lead source is a word in a chip.
 */
export const LD_STEPS = [1, 2, 3, 4, 5, 6] as const;
export type LdStep = (typeof LD_STEPS)[number];

/** The places leads already come from (text chips). The keys are `ld.src.<id>`. */
export const LD_SOURCES = ["meta", "indiamart", "justdial", "sheets", "website", "missed"] as const;

/** The industries that use Lead Desk as it is (no pack of their own yet), as chips. The keys are `ld.chip.<n>`. */
export const LD_CHIPS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** The workforce plans' ids are not named here: the plans data says which plan is which kind. Lead Desk plans are the calls kind; their names in the catalogue version 3 are these (names, the same in every language). */
const LD_PLAN_NAMES: Readonly<Record<string, string>> = { calls_payg: "Pay as you go", calls_300: "Lead Desk 300", calls_1000: "Lead Desk 1,000" };
export const leadDeskPlanName = (id: string, catalogueName: string): string => LD_PLAN_NAMES[id] ?? catalogueName;

/**
 * The business types with a deep "How Lead Desk works for ..." block on their page: how many steps it has, and whether it ends with a plain note. A business type that is not listed (a new landing.json) simply has no block
 * until its words are written.
 */
export const LD_PACK_FLOW: Readonly<Record<string, { steps: number; note: boolean }>> = {
  textiles: { steps: 4, note: false },
  construction_materials: { steps: 4, note: false },
  education: { steps: 3, note: true },
};

/** The keys of one deep card (title, line) of the home page; null for a business type without them. */
export function deepCardKeys(packId: string): { title: SiteKey; line: SiteKey } | null {
  return packId in LD_PACK_FLOW ? { title: `ld.deep.${packId}.t` as SiteKey, line: `ld.deep.${packId}.d` as SiteKey } : null;
}

/** The keys of one business type's block: its title, its steps in order and its note (if it has one); null for a business type without a block. */
export function packFlowKeys(packId: string): { title: SiteKey; steps: SiteKey[]; note: SiteKey | null } | null {
  const flow = LD_PACK_FLOW[packId];
  if (!flow) return null;
  return {
    title: `ld.pack.${packId}.t` as SiteKey,
    steps: Array.from({ length: flow.steps }, (_, i) => `ld.pack.${packId}.${i + 1}` as SiteKey),
    note: flow.note ? (`ld.pack.${packId}.note` as SiteKey) : null,
  };
}
