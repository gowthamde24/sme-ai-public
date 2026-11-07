"use server";

import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { addRecipients, putCampaign } from "@/lib/api/campaigns";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getLedgerStatement } from "@/lib/api/ledger";
import { requireUser } from "@/lib/auth/session";
import { reminderText } from "./remind-text";
import { appV4 } from "@/lib/screens/flag";

/**
 * "Remind" on the Money page (app v4 part 6, owner 7 Nov 2026; the flow is C1's): it makes a DRAFT payment reminder (a `payment_due` campaign with ONE recipient) and nothing else. Nothing is sent: the Owner approves the draft on the
 * campaign page (second factor, after seeing sample messages) and every message then goes through the outbox's usual checks (consent, STOP, quiet hours, the suppression key). The amount and the date are the ledger's own (the oldest
 * claim that is overdue, and what is overdue; else what is open); the words are fixed text, never written by a model. A customer with no contact has nobody to message: nothing is created. The campaign id is made by the screen, so a retry
 * changes the same draft. Owner, Admin and Sales may build the draft; the API checks again.
 */
export type RemindInput = { companyId: string | null; contactId: string | null; name: string };
export type RemindResult = { ok: true; campaignId: string; added: number } | { ok: false; error: "forbidden" | "invalid" | "no_contact" | "nothing_due" | "not_added" | "not_available" | "down" };
const STAFF = ["owner", "admin", "sales"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function remindAction(tenantId: string, campaignId: string, input: RemindInput): Promise<RemindResult> {
  if (!appV4()) return { ok: false, error: "not_available" };
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(campaignId) || typeof input !== "object" || input === null) return { ok: false, error: "invalid" };
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  const company = input.companyId !== null && isCanonicalUuid(input.companyId) ? input.companyId : null;
  const contact = input.contactId !== null && isCanonicalUuid(input.contactId) ? input.contactId : null;
  // an id that is there but is not one is refused (never quietly dropped)
  if (name === "" || (input.companyId !== null && company === null) || (input.contactId !== null && contact === null)) return { ok: false, error: "invalid" };
  if (contact === null) return { ok: false, error: "no_contact" }; // nobody to message: nothing is made
  const user = await requireUser();
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (!STAFF.includes(tenant.role)) return { ok: false, error: "forbidden" };
    const statement = await getLedgerStatement(user.accessToken, tenantId, company ? { company_id: company } : { contact_id: contact });
    const open = statement.open_invoices.filter((i) => i.open_paise > 0 && DAY.test(i.due_date)).sort((a, b) => a.due_date.localeCompare(b.due_date));
    if (open.length === 0) return { ok: false, error: "nothing_due" };
    const overdue = open.filter((i) => i.overdue_days > 0);
    const basis = overdue.length > 0 ? overdue : open;
    const amount = basis.reduce((a, i) => a + i.open_paise, 0);
    const oldest = basis[0];
    await putCampaign(user.accessToken, tenantId, campaignId, {
      name: `Reminder: ${name}`.slice(0, 100),
      kind: "payment_due",
      language: "en",
      waTemplateId: null,
      messageText: reminderText(tenant.name, amount, oldest.due_date),
      steps: [{ offset_days: 0, time: "10:00" }],
      callAfterStep: null,
      callWaitHours: 24,
    });
    const added = await addRecipients(user.accessToken, tenantId, campaignId, [{ contact_id: contact, due_date: oldest.due_date, amount_paise: amount, ...(oldest.invoice_no ? { reference: oldest.invoice_no.slice(0, 80) } : {}) }]);
    return added.added > 0 ? { ok: true, campaignId, added: added.added } : { ok: false, error: "not_added" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 422) return { ok: false, error: "invalid" };
    }
    return { ok: false, error: "down" };
  }
}
