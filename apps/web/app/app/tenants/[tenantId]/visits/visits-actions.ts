"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { BookInput, CustomersResult, HoursResult, SlotsResult, StepResult } from "@/components/v2/app/visits/actions-types";
import { dayShort, isDay } from "@/components/v2/app/visits/dates";
import { indiaClock } from "@/components/v2/app/today/time";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { VISIT_OUTCOMES, WEEKDAYS, bookVisit, changeVisit, completeVisit, getSlots, putVisitSettings, stepVisit, type StoreSettings, type Visit, type VisitOutcome, type VisitStep } from "@/lib/api/visits";
import { requireUser } from "@/lib/auth/session";

import { refusalOf } from "./visits-refusals";
import { searchCustomers } from "./visits-data";

const SLOT = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLOCK = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

async function context(tenantId: string) {
  const user = await requireUser();
  const lang = await getLang();
  return { user, lang, t: appT(lang), valid: isCanonicalUuid(tenantId) };
}
type Ctx = Awaited<ReturnType<typeof context>>;

const refresh = (tenantId: string) => {
  revalidatePath(`/app/tenants/${tenantId}/visits`);
  revalidatePath(`/app/tenants/${tenantId}`);
};

/** A refusal as OUR sentence. A rejected session goes to sign-in. */
function refused(error: unknown, t: Ctx["t"]): Extract<StepResult, { ok: false }> {
  try {
    const r = refusalOf(error);
    return { ok: false, error: t(r.key as "today.err.generic"), ...(r.mfa ? { mfa: true } : {}), ...(r.quotes ? { quotes: true } : {}), ...(r.stale ? { stale: true } : {}) };
  } catch (e) {
    if (e instanceof ApiAuthError) redirect("/login");
    throw e;
  }
}

const whenOf = (v: Visit, lang: Ctx["lang"]) => `${dayShort(v.date, lang)}, ${indiaClock(v.starts_at)}`;

/** Book. The page's `visitId` makes a second press a retry. Nothing is sent to the customer. Owner, Admin, Sales. */
export async function bookVisitAction(tenantId: string, input: BookInput): Promise<StepResult> {
  const { user, t, lang, valid } = await context(tenantId);
  const ok = valid && isCanonicalUuid(input.visitId) && isCanonicalUuid(input.leadId) && isDay(input.date) && SLOT.test(input.slot) && Number.isInteger(input.partySize) && input.partySize >= 1 && input.partySize <= 50;
  if (!ok || input.purpose.length > 200 || input.note.length > 1000) return { ok: false, error: t("visits.err.invalid") };
  const advanceRupees = input.advanceRupees;
  if (advanceRupees !== null && !(Number.isFinite(advanceRupees) && advanceRupees >= 1 && advanceRupees <= 1_000_000)) return { ok: false, error: t("visits.err.invalid") };
  try {
    const { visit } = await bookVisit(user.accessToken, tenantId, {
      visitId: input.visitId,
      leadId: input.leadId,
      date: input.date,
      slot: input.slot,
      partySize: input.partySize,
      purpose: input.purpose || null,
      note: input.note || null,
      advancePaise: advanceRupees === null ? null : Math.round(advanceRupees * 100),
    });
    refresh(tenantId);
    return { ok: true, message: t("visits.toast.booked", { who: visit.who, when: whenOf(visit, lang) }) };
  } catch (error) {
    return refused(error, t);
  }
}

/** Move to another day and time (the visit is waiting for the customer to confirm again). */
export async function moveVisitAction(tenantId: string, id: string, date: string, slot: string): Promise<StepResult> {
  const { user, t, lang, valid } = await context(tenantId);
  if (!valid || !isCanonicalUuid(id) || !isDay(date) || !SLOT.test(slot)) return { ok: false, error: t("visits.err.invalid") };
  try {
    const { visit } = await changeVisit(user.accessToken, tenantId, id, { date, slot });
    refresh(tenantId);
    return { ok: true, message: t("visits.toast.moved", { when: whenOf(visit, lang) }) };
  } catch (error) {
    return refused(error, t);
  }
}

const STEP_TOAST: Record<VisitStep, "visits.toast.confirmed" | "visits.toast.arrived" | "visits.toast.noshow" | "visits.toast.cancelled"> = {
  confirm: "visits.toast.confirmed",
  arrive: "visits.toast.arrived",
  "no-show": "visits.toast.noshow",
  cancel: "visits.toast.cancelled",
};

async function step(tenantId: string, id: string, which: VisitStep, reason?: string): Promise<StepResult> {
  const { user, t, valid } = await context(tenantId);
  if (!valid || !isCanonicalUuid(id)) return { ok: false, error: t("today.err.state"), stale: true };
  try {
    const { visit } = await stepVisit(user.accessToken, tenantId, id, which, reason && reason.length <= 200 ? reason : undefined);
    refresh(tenantId);
    return { ok: true, message: t(STEP_TOAST[which], { who: visit.who }) };
  } catch (error) {
    return refused(error, t);
  }
}

/** Booked or confirmed: the customer agreed. Sends nothing. */
export async function confirmVisitAction(tenantId: string, id: string): Promise<StepResult> {
  return step(tenantId, id, "confirm");
}
/** They are here (only on the day). */
export async function arriveVisitAction(tenantId: string, id: string): Promise<StepResult> {
  return step(tenantId, id, "arrive");
}
/** They did not come (only once the time has come). */
export async function noShowVisitAction(tenantId: string, id: string): Promise<StepResult> {
  return step(tenantId, id, "no-show");
}
/** Cancel, with a short reason if there is one. Sends nothing: the person tells the customer. */
export async function cancelVisitAction(tenantId: string, id: string, reason: string): Promise<StepResult> {
  return step(tenantId, id, "cancel", typeof reason === "string" ? reason.trim() : undefined);
}

/** How the visit ended. "Bought" with an `orderId` also starts the order from the customer's approved quote (Owner or Admin, second factor); if that cannot be done the visit stays "here now". */
export async function completeVisitAction(tenantId: string, id: string, outcome: VisitOutcome, orderId: string | null): Promise<StepResult> {
  const { user, t, valid } = await context(tenantId);
  if (!valid || !isCanonicalUuid(id) || !(VISIT_OUTCOMES as readonly string[]).includes(outcome) || (orderId !== null && (!isCanonicalUuid(orderId) || outcome !== "bought"))) return { ok: false, error: t("today.err.state"), stale: true };
  try {
    const done = await completeVisit(user.accessToken, tenantId, id, { outcome, ...(orderId ? { orderId } : {}) });
    refresh(tenantId);
    if (done.orderId) return { ok: true, message: t("visits.toast.order"), orderId: done.orderId };
    return { ok: true, message: t("visits.toast.completed", { who: done.visit.who }) };
  } catch (error) {
    return refused(error, t);
  }
}

/** The free times of one day. */
export async function slotsAction(tenantId: string, date: string): Promise<SlotsResult> {
  const { user, t, valid } = await context(tenantId);
  if (!valid || !isDay(date)) return { ok: false, error: t("visits.err.invalid") };
  try {
    return { ok: true, slots: await getSlots(user.accessToken, tenantId, date) };
  } catch (error) {
    return refused(error, t);
  }
}

/** A name search for "Book a visit": the name and city of the customers found, nothing else. */
export async function customersAction(tenantId: string, query: string): Promise<CustomersResult> {
  const { user, t, valid } = await context(tenantId);
  if (!valid || typeof query !== "string") return { ok: false, error: t("visits.err.invalid") };
  try {
    return { ok: true, items: await searchCustomers(user.accessToken, tenantId, query) };
  } catch (error) {
    return refused(error, t);
  }
}

/** The store hours, the whole week at once. Owner and Admin. */
export async function saveHoursAction(tenantId: string, settings: Omit<StoreSettings, "is_default">): Promise<HoursResult> {
  const { user, t, valid } = await context(tenantId);
  const week = settings?.weekly_hours;
  const weekOk = !!week && WEEKDAYS.every((d) => week[d] === null || (typeof week[d]?.open === "string" && SLOT.test(week[d]!.open) && typeof week[d]?.close === "string" && CLOCK.test(week[d]!.close) && week[d]!.open < week[d]!.close));
  if (!valid || !weekOk || !Array.isArray(settings.closed_dates) || settings.closed_dates.length > 200 || !settings.closed_dates.every(isDay)) return { ok: false, error: t("visits.err.invalid") };
  try {
    const saved = await putVisitSettings(user.accessToken, tenantId, { weekly_hours: settings.weekly_hours, closed_dates: settings.closed_dates, slot_minutes: settings.slot_minutes, max_parallel: settings.max_parallel });
    refresh(tenantId);
    return { ok: true, message: t("visits.hours.saved"), settings: saved };
  } catch (error) {
    const r = refused(error, t);
    return { ok: false, error: r.error };
  }
}
