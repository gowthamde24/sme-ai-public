"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { EntryFormInput } from "@/components/v2/app/ledger/EntrySheet";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { ENTRY_KINDS, METHODS, REASONS, putLedgerEntry, setCreditLimit, voidLedgerEntry, type Party } from "@/lib/api/ledger";
import { rupeesToPaise } from "@/lib/money";
import { requireUser } from "@/lib/auth/session";

import { ledgerRefusalOf } from "./ledger-refusals";

type Failed = { ok: false; error: string; mfa?: boolean };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: string) => typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

async function context() {
  const user = await requireUser();
  return { user, t: appT(await getLang()) };
}
function failed(error: unknown, t: Awaited<ReturnType<typeof context>>["t"]): Failed {
  try {
    const r = ledgerRefusalOf(error);
    return { ok: false, error: t(r.key as "today.err.generic"), ...(r.mfa ? { mfa: true } : {}) };
  } catch (e) {
    if (e instanceof ApiAuthError) redirect("/login");
    throw e;
  }
}

/**
 * Write down one entry of the ledger (a payment received, a charge, an adjustment or a concession) for ONE party. The party is bound by the page, never taken from the form. The amount is typed rupees, turned into paise
 * here; the id is the form's, so a second press is a retry. Adjustments and concessions are the Owner's or an Admin's with the authenticator code (the API and the database decide). Nothing is sent to anyone.
 */
export async function recordEntryAction(tenantId: string, party: Party, revalidate: string, input: EntryFormInput): Promise<{ ok: true; receiptNo: string | null; entryId: string; replayed: boolean } | Failed> {
  const { user, t } = await context();
  const partyId = "company_id" in party ? party.company_id : party.contact_id;
  const paise = typeof input?.amount === "string" ? rupeesToPaise(input.amount) : null;
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(partyId) && isCanonicalUuid(input?.entryId) && (ENTRY_KINDS as readonly string[]).includes(input?.kind) && paise !== null && paise >= 100 && validDay(input.entryDate) &&
    (input.kind === "payment" ? (METHODS as readonly string[]).includes(input.method) : true) && (input.kind === "charge" || (input.kind === "adjustment" && input.direction === "debit") ? validDay(input.dueDate) && input.dueDate >= input.entryDate : true) &&
    (input.kind === "adjustment" || input.kind === "concession" ? (REASONS as readonly string[]).includes(input.reasonCode) : true) && input.invoiceNo.length <= 40 && input.reference.length <= 40;
  if (!ok) return { ok: false, error: t("due.err.invalid") };
  try {
    const out = await putLedgerEntry(user.accessToken, tenantId, input.entryId, {
      kind: input.kind,
      party,
      entryDate: input.entryDate,
      amountPaise: paise,
      ...(input.kind === "charge" || (input.kind === "adjustment" && input.direction === "debit") ? { dueDate: input.dueDate } : {}),
      ...(input.kind === "adjustment" ? { direction: input.direction } : {}),
      ...(input.kind === "charge" && input.invoiceNo.trim() ? { invoiceNo: input.invoiceNo.trim() } : {}),
      ...(input.kind === "charge" && input.reference.trim() ? { reference: input.reference.trim() } : {}),
      ...(input.kind === "payment" ? { method: input.method as (typeof METHODS)[number] } : {}),
      ...(input.kind === "adjustment" || input.kind === "concession" ? { reasonCode: input.reasonCode as (typeof REASONS)[number] } : {}),
    });
    revalidatePath(revalidate);
    return { ok: true, receiptNo: out.receipt_no, entryId: out.id, replayed: out.replayed };
  } catch (error) {
    return failed(error, t);
  }
}

/** Void an entry (Owner, Admin). It is never changed or deleted: the account is worked out again without it. */
export async function voidEntryAction(tenantId: string, revalidate: string, entryId: string): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(entryId)) return { ok: false, error: t("due.err.invalid") };
  try {
    await voidLedgerEntry(user.accessToken, tenantId, entryId);
    revalidatePath(revalidate);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}

/** Set (or clear, with null) a customer's credit limit: the Owner's, with the authenticator code. */
export async function setCreditLimitAction(tenantId: string, companyId: string, revalidate: string, limitPaise: number | null): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(companyId) || (limitPaise !== null && (!Number.isSafeInteger(limitPaise) || limitPaise < 100 || limitPaise > 100_000_000_000))) return { ok: false, error: t("due.err.invalid") };
  try {
    await setCreditLimit(user.accessToken, tenantId, companyId, limitPaise);
    revalidatePath(revalidate);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}
