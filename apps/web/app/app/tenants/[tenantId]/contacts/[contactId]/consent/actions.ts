"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import {
  BASES,
  CHANNELS,
  EVIDENCE_KINDS,
  EVIDENCE_LABEL_PATTERN,
  recordConsent,
  type Basis,
  type ConsentChannel,
  type ConsentInput,
  type Consents,
  type EvidenceKind,
} from "@/lib/api/consent";
import { requireUser } from "@/lib/auth/session";

/** What the screen shows after a press: what was written down, by whom (the signed-in person) and when (the time this screen sent it). Never a number or an address. */
export type ConsentFormState =
  | { ok?: boolean; error?: string; channel?: ConsentChannel; status?: "granted" | "withdrawn"; by?: string; at?: string; consents?: Consents }
  | undefined;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Every failure becomes a short sentence of OUR wording; nothing the API, the database or the form said is echoed. */
function describe(error: unknown): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return "Your role cannot record consent.";
    if (error.status === 404) return "This person is not available.";
    if (error.status === 409) return "This cannot be recorded for this person right now.";
    if (error.status === 422) return "Check the values and try again.";
  }
  return "Could not record this. Try again.";
}

/**
 * Write down one consent entry for one channel, in the person's own words, through the API only. The screen does not check or judge it. `granted` needs a basis, a kind of evidence and a short label;
 * `withdrawn` needs nothing else. The answer says who recorded it (the signed-in person) and when (the moment this action ran), and shows the three states the API now holds.
 */
export async function recordConsentAction(tenantId: string, contactId: string, _prev: ConsentFormState, formData: FormData): Promise<ConsentFormState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(contactId)) return { ok: false, error: "This person is not available." };
  const channel = field(formData, "channel") as ConsentChannel;
  const status = field(formData, "status");
  if (!CHANNELS.includes(channel)) return { ok: false, error: "Choose the channel." };
  if (status !== "granted" && status !== "withdrawn") return { ok: false, error: "Choose Granted or Withdrawn." };
  let input: ConsentInput;
  if (status === "withdrawn") input = { channel, status };
  else {
    const basis = field(formData, "basis") as Basis;
    const kind = field(formData, "evidence_kind") as EvidenceKind;
    const label = field(formData, "evidence_label");
    if (!BASES.includes(basis)) return { ok: false, error: "Choose the basis." };
    if (!EVIDENCE_KINDS.includes(kind)) return { ok: false, error: "Choose the kind of evidence." };
    if (!EVIDENCE_LABEL_PATTERN.test(label)) return { ok: false, error: "Give the evidence a short label: letters, digits and . _ # / - only, no spaces, no names, numbers or addresses." };
    input = { channel, status, basis, evidenceKind: kind, evidenceLabel: label };
  }
  let consents: Consents;
  try {
    consents = await recordConsent(user.accessToken, tenantId, contactId, input);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(`/app/tenants/${tenantId}/contacts/${contactId}/consent`);
  revalidatePath(`/app/tenants/${tenantId}`);
  return { ok: true, channel, status, by: user.email ?? "your account", at: new Date().toISOString(), consents };
}
