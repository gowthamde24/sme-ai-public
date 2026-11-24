import { apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { assistantStatusScreens } from "@/lib/screens/flag";

/** What the PHONE assistant has to answer with (C1's `GET /v1/tenants/{t}/assistant/phone-knows`, 28 Nov 2026): counts, what is missing (in the order that helps most) and whether calls can be answered from the business's own facts. */
export const KNOWS_MISSING = ["price_list", "catalogue", "answers"] as const;
export type KnowsMissing = (typeof KNOWS_MISSING)[number];
export type PhoneKnows = { priceRows: number; catalogueItems: number; faqAnswers: number; notesLines: number; hasHours: boolean; missing: KnowsMissing[]; ready: boolean };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);

/** The answer, checked: an odd shape is no line at all (the page then shows nothing). The API's own sentence is not used: the words come from the string store, in the person's language. */
export function parseKnows(json: unknown): PhoneKnows | null {
  if (!isRec(json) || !Array.isArray(json.missing) || typeof json.ready !== "boolean") return null;
  const missing = json.missing.filter((m): m is KnowsMissing => (KNOWS_MISSING as readonly unknown[]).includes(m));
  if (missing.length !== json.missing.length) return null;
  return { priceRows: count(json.price_rows), catalogueItems: count(json.catalogue_items), faqAnswers: count(json.faq_answers), notesLines: count(json.notes_lines), hasHours: json.has_hours === true, missing, ready: json.ready };
}

/** `on` = C1's API (a failure is no line), `mock` = a made-up answer on staging (nothing priced yet), off = no line. Behind the assistant-status flag, as the page's other parts are. */
export async function readPhoneKnows(accessToken: string, tenantId: string): Promise<PhoneKnows | null> {
  const mode = assistantStatusScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return null;
  if (mode === "mock") return { priceRows: 0, catalogueItems: 12, faqAnswers: 3, notesLines: 1, hasHours: true, missing: ["price_list"], ready: false };
  try {
    return parseKnows(await apiRequest(`/v1/tenants/${tenantId}/assistant/phone-knows`, accessToken));
  } catch {
    return null;
  }
}
