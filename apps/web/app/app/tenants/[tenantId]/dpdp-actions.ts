"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { clientIp } from "@/lib/auth/signup-limit";
import { requireUser } from "@/lib/auth/session";
import { changeMarketing, dpdpMode, raiseGrievance } from "@/lib/dpdp/source";
import { GRIEVANCE_KINDS, MAX_GRIEVANCE_CONTACT, MAX_GRIEVANCE_DETAILS, MAX_GRIEVANCE_NAME, type GrievanceKind, type GrievanceResult, type MarketingResult } from "@/lib/dpdp/types";
import { sharedLeadLimiter } from "@/lib/site/lead-limit";
import { oneLine } from "@/lib/site/lead";

/**
 * The two moves of Settings > Privacy and data that are not an erasure or a download (job DQ part 2): the marketing switch (the same one call gives and withdraws; it takes effect at once and is never refused) and "Raise a
 * grievance" (stored by the API, acknowledged at once, answered in the time the notice promises). The input is whatever the browser sent: it is checked here.
 */
export async function setMarketingAction(tenantId: string, given: boolean): Promise<MarketingResult> {
  const user = await requireUser();
  if (dpdpMode() === "off" || typeof given !== "boolean") return { ok: false, error: "forbidden" };
  const out = await changeMarketing(user.accessToken, given, "settings");
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
  return out;
}

export async function grievanceAction(_tenantId: string, input: unknown): Promise<GrievanceResult> {
  await requireUser();
  if (dpdpMode() === "off") return { ok: false, error: "down" };
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const name = oneLine(raw.name, MAX_GRIEVANCE_NAME);
  if (name === null) return { ok: false, error: "name" };
  const contact = oneLine(raw.contact, MAX_GRIEVANCE_CONTACT);
  if (contact === null || contact.length < 3) return { ok: false, error: "contact" };
  const kind: GrievanceKind = (GRIEVANCE_KINDS as readonly unknown[]).includes(raw.kind) ? (raw.kind as GrievanceKind) : "other";
  const details = typeof raw.details === "string" ? raw.details.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, MAX_GRIEVANCE_DETAILS) : "";
  const language = raw.language === "te" || raw.language === "hi" || raw.language === "kn" ? raw.language : "en";
  if (!sharedLeadLimiter().allow(clientIp(await headers()))) return { ok: false, error: "rate" };
  return raiseGrievance({ name, contact, kind, details, language });
}
