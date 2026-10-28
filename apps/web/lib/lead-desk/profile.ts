/**
 * What a lead is, whatever the source (job context-and-easy-sources part B3, contract-context-sources.md): the normalised `profile` the API adds to `GET /leads` and `GET /leads/{id}`. Everything is optional and checked; a lead without a profile is shown as before.
 * Guessed fields carry a confidence ("low" | "medium") and get a small marker; what the person fixed is `fixedByYou` and is never marked. The words the customer wrote are kept (`originalText`) and shown as they wrote them.
 */
export const URGENCIES = ["low", "normal", "high"] as const;
export type Urgency = (typeof URGENCIES)[number];
export const JUNK_REASONS = ["spam", "test", "no_contact", "abuse"] as const;
export type JunkReason = (typeof JUNK_REASONS)[number];
export const FIELDS = ["name", "phone", "email", "city", "area", "need", "quantity", "budget", "timeline", "urgency", "language"] as const;
export type Field = (typeof FIELDS)[number];
export type LeadProfile = {
  need: string | null;
  quantity: string | null;
  area: string | null;
  city: string | null;
  budget: string | null;
  timeline: string | null;
  urgency: Urgency | null;
  campaign: string | null;
  originalText: string | null;
  /** "high" is the default; only the guessed fields are listed. */
  guessed: Field[];
  duplicateOf: string | null;
  mergedCount: number;
  junk: JunkReason | null;
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null);
/** Phone and e-mail are the two fields the profile uses different names for. */
const FIELD_OF: Record<string, Field> = { phone_e164: "phone" };

export function parseProfile(json: unknown): LeadProfile | null {
  if (!isRec(json)) return null;
  const conf = isRec(json.confidence) ? json.confidence : {};
  const fixed = Array.isArray(json.fixed_by_you) ? json.fixed_by_you : [];
  const guessed = Object.entries(conf).flatMap(([k, v]) => {
    const f = FIELD_OF[k] ?? k;
    return (v === "low" || v === "medium") && (FIELDS as readonly string[]).includes(f) && !fixed.includes(k) ? [f as Field] : [];
  });
  const junk = isRec(json.junk) && (JUNK_REASONS as readonly unknown[]).includes(json.junk.reason) ? (json.junk.reason as JunkReason) : null;
  return {
    need: text(json.need, 200),
    quantity: text(json.quantity, 100),
    area: text(json.area, 100),
    city: text(json.city, 100),
    budget: text(json.budget, 100),
    timeline: text(json.timeline, 100),
    urgency: (URGENCIES as readonly unknown[]).includes(json.urgency) ? (json.urgency as Urgency) : null,
    campaign: text(json.campaign, 120),
    originalText: text(json.original_text, 2000),
    guessed,
    duplicateOf: typeof json.duplicate_of === "string" ? json.duplicate_of.slice(0, 80) : null,
    mergedCount: typeof json.merged_count === "number" && json.merged_count > 0 ? Math.min(Math.trunc(json.merged_count), 999) : 0,
    junk,
  };
}
