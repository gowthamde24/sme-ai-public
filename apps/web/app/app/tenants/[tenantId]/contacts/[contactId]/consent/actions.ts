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
import { serverT } from "@/i18n/server-t";
import { makeT, type Say } from "@/components/v2/app/words";

/** What the screen shows after a press: what was written down, by whom (the signed-in person) and when (the time this screen sent it). Never a number or an address. */
export type ConsentFormState =
  | { ok?: boolean; error?: string; channel?: ConsentChannel; status?: "granted" | "withdrawn"; by?: string; at?: string; consents?: Consents }
  | undefined;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Every failure becomes a short sentence of OUR wording; nothing the API, the database or the form said is echoed. */
function describe(error: unknown, t: Say = makeT()): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return t("cont.your_role_cannot_record_consent");
    if (error.status === 404) return t("cont.this_person_is_not_available");
    if (error.status === 409) return t("cont.this_cannot_be_recorded_for_this");
    if (error.status === 422) return t("cont.check_the_values_and_try_again");
  }
  return t("cont.could_not_record_this_try_again");
}

/**
 * Write down one consent entry for one channel, in the person's own words, through the API only. The screen does not check or judge it. `granted` needs a basis, a kind of evidence and a short label;
 * `withdrawn` needs nothing else. The answer says who recorded it (the signed-in person) and when (the moment this action ran), and shows the three states the API now holds.
 */
export async function recordConsentAction(tenantId: string, contactId: string, _prev: ConsentFormState, formData: FormData): Promise<ConsentFormState> {
  const t = await serverT(["cont."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(contactId)) return { ok: false, error: t("cont.this_person_is_not_available") };
  const channel = field(formData, "channel") as ConsentChannel;
  const status = field(formData, "status");
  if (!CHANNELS.includes(channel)) return { ok: false, error: t("cont.choose_the_channel") };
  if (status !== "granted" && status !== "withdrawn") return { ok: false, error: t("cont.choose_granted_or_withdrawn") };
  let input: ConsentInput;
  if (status === "withdrawn") input = { channel, status };
  else {
    const basis = field(formData, "basis") as Basis;
    const kind = field(formData, "evidence_kind") as EvidenceKind;
    const label = field(formData, "evidence_label");
    if (!BASES.includes(basis)) return { ok: false, error: t("cont.choose_the_basis") };
    if (!EVIDENCE_KINDS.includes(kind)) return { ok: false, error: t("cont.choose_the_kind_of_evidence") };
    if (!EVIDENCE_LABEL_PATTERN.test(label)) return { ok: false, error: t("cont.give_the_evidence_a_short_label") };
    input = { channel, status, basis, evidenceKind: kind, evidenceLabel: label };
  }
  let consents: Consents;
  try {
    consents = await recordConsent(user.accessToken, tenantId, contactId, input);
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(`/app/tenants/${tenantId}/contacts/${contactId}/consent`);
  revalidatePath(`/app/tenants/${tenantId}`);
  return { ok: true, channel, status, by: user.email ?? t("cont.your_account"), at: new Date().toISOString(), consents };
}
