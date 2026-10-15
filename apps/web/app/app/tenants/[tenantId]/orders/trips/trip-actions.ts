"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { NOTIFY_KINDS, PROBLEM_CODES, SETTABLE_STATUSES, notifySite, planTrip, setTripStatus, updateTrip, type TripInput } from "@/lib/api/deliveries";
import { requireUser } from "@/lib/auth/session";
import { ETA, PHONE, VEHICLE, isDay } from "@/components/v2/app/deliveries/trip-logic";

import { tripRefusalOf } from "./trip-refusals";

type Refused = { ok: false; error: string; mfa?: boolean; stale?: boolean };
export type TripFormInput = { plannedDate: string; vehicleNo: string | null; driverName: string | null; driverPhone: string | null; siteId: string | null; lines: { line_no: number; quantity: number }[] };

async function context() {
  const user = await requireUser();
  return { user, t: appT(await getLang()) };
}
type Ctx = Awaited<ReturnType<typeof context>>;

function refused(error: unknown, t: Ctx["t"]): Refused {
  try {
    const r = tripRefusalOf(error);
    return { ok: false, error: t(r.key as "today.err.generic"), ...(r.mfa ? { mfa: true } : {}), ...(r.stale ? { stale: true } : {}) };
  } catch (e) {
    if (e instanceof ApiAuthError) redirect("/login");
    throw e;
  }
}

function checked(input: TripFormInput): TripInput | null {
  const ok =
    input && isDay(input.plannedDate) && (input.vehicleNo === null || VEHICLE.test(input.vehicleNo)) && (input.driverName === null || (input.driverName.length >= 1 && input.driverName.length <= 80)) &&
    (input.driverPhone === null || PHONE.test(input.driverPhone)) && (input.siteId === null || isCanonicalUuid(input.siteId)) && Array.isArray(input.lines) && input.lines.length >= 1 && input.lines.length <= 5 &&
    input.lines.every((l) => Number.isInteger(l.line_no) && l.line_no >= 1 && l.line_no <= 5 && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= 10_000_000) && new Set(input.lines.map((l) => l.line_no)).size === input.lines.length;
  return ok ? { plannedDate: input.plannedDate, vehicleNo: input.vehicleNo, driverName: input.driverName, driverPhone: input.driverPhone, siteId: input.siteId, siteContactId: null, lines: input.lines } : null;
}

const refresh = (tenantId: string, orderId?: string) => {
  revalidatePath(`/app/tenants/${tenantId}/orders/trips`);
  if (orderId) revalidatePath(`/app/tenants/${tenantId}/orders/${orderId}`);
};

/** Plan a trip for an order. The id is the page's, so a second press is a retry. Owner, Admin, Sales. Nothing is sent to anyone. */
export async function planTripAction(tenantId: string, orderId: string, tripId: string, input: TripFormInput): Promise<{ ok: true; date: string } | Refused> {
  const { user, t } = await context();
  const clean = checked(input);
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(orderId) || !isCanonicalUuid(tripId) || !clean) return { ok: false, error: t("trip.err.invalid") };
  try {
    await planTrip(user.accessToken, tenantId, orderId, { ...clean, tripId });
    refresh(tenantId, orderId);
    return { ok: true, date: clean.plannedDate };
  } catch (error) {
    return refused(error, t);
  }
}

/** Change a planned trip (while it is planned or in a problem). */
export async function updateTripAction(tenantId: string, tripId: string, input: TripFormInput): Promise<{ ok: true; date: string } | Refused> {
  const { user, t } = await context();
  const clean = checked(input);
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(tripId) || !clean) return { ok: false, error: t("trip.err.invalid") };
  try {
    await updateTrip(user.accessToken, tenantId, tripId, clean);
    refresh(tenantId);
    return { ok: true, date: clean.plannedDate };
  } catch (error) {
    return refused(error, t);
  }
}

/** Loaded, on the way, a problem (with its reason from the closed list), back to planned, or cancelled. "Delivered" is its own route: it needs the proof photo. */
export async function setTripStatusAction(tenantId: string, tripId: string, status: string, problem?: string): Promise<{ ok: true } | Refused> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(tripId) || !(SETTABLE_STATUSES as readonly string[]).includes(status) || (status === "problem") !== (problem !== undefined) || (problem !== undefined && !(PROBLEM_CODES as readonly string[]).includes(problem)))
    return { ok: false, error: t("trip.err.invalid") };
  try {
    await setTripStatus(user.accessToken, tenantId, tripId, status as (typeof SETTABLE_STATUSES)[number], problem as (typeof PROBLEM_CODES)[number] | undefined);
    refresh(tenantId);
    return { ok: true };
  } catch (error) {
    return refused(error, t);
  }
}

/**
 * Tell the site contact how the trip is going: a FIXED message (no amounts, no model) that goes through the outbox, which applies the contact's consent, the number's suppression key, the quiet hours and the daily
 * limit. The answer says what happened to it. A delay reads as a complaint to the outbox and is held for a person: on purpose.
 */
export async function notifyTripAction(tenantId: string, tripId: string, kind: string, eta: string | null, language: string): Promise<{ ok: true; text: string; status: string } | Refused> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(tripId) || !(NOTIFY_KINDS as readonly string[]).includes(kind) || (eta !== null && !ETA.test(eta)) || !["en", "te", "hi", "kn", "ta"].includes(language)) return { ok: false, error: t("trip.err.invalid") };
  try {
    const out = await notifySite(user.accessToken, tenantId, tripId, { messageId: crypto.randomUUID(), kind: kind as (typeof NOTIFY_KINDS)[number], eta, language: language as "en" });
    refresh(tenantId);
    revalidatePath(`/app/tenants/${tenantId}/outbox`);
    return { ok: true, text: out.text, status: out.status };
  } catch (error) {
    return refused(error, t);
  }
}
