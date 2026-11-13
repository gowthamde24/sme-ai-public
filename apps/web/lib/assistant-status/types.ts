/**
 * The state of the business's assistant (owner, 13 Nov 2026): Not live, In training (the owner has started the setup), Live. Only a business name and a connected phone number are needed to go live; everything else has a working default. Pure: no fetch, no React.
 */
export const STATES = ["not_live", "in_training", "live"] as const;
export type AssistantState = (typeof STATES)[number];
/** What is still needed to go live (the API's closed words). */
export const MISSING = ["business_name", "phone_number"] as const;
export type Missing = (typeof MISSING)[number];
/** The parts that still use the defaults (the tabs of My assistant show "Using defaults"). */
export const PARTS = ["knowledge", "voice", "rules"] as const;
export type Part = (typeof PARTS)[number];

export type AssistantStatus = { state: AssistantState; canGoLive: boolean; missing: Missing[]; usingDefaults: Part[] };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isState = (v: unknown): v is AssistantState => typeof v === "string" && (STATES as readonly string[]).includes(v);

/** C1's answer, checked: an odd shape is no status (the menu then shows no badge). */
export function parseStatus(json: unknown): AssistantStatus | null {
  if (!isRec(json) || !isState(json.state) || typeof json.can_go_live !== "boolean" || !Array.isArray(json.missing)) return null;
  const missing = json.missing.filter((m): m is Missing => (MISSING as readonly unknown[]).includes(m));
  if (missing.length !== json.missing.length) return null;
  const using = Array.isArray(json.using_defaults) ? json.using_defaults.filter((p): p is Part => (PARTS as readonly unknown[]).includes(p)) : [];
  return { state: json.state, canGoLive: json.can_go_live, missing, usingDefaults: using };
}
