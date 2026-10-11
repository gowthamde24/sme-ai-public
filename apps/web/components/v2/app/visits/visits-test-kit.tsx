import { vi } from "vitest";

import { visitsWords } from "@/app/app/tenants/[tenantId]/visits/visits-words";
import { SETTINGS, slotsJson } from "@/lib/api/visits-fixtures";

import type { VisitsActions } from "./actions-types";

/** Shared by the tests of the Visits page: the English words, a pinned clock (Wednesday 14 October 2026, 10:00 in India) and actions that can be watched. Test code only. */
export const WORDS = visitsWords("en");
export const NOW = Date.parse("2026-10-14T04:30:00Z");
export const TODAY = "2026-10-14";
export const BASE = "/app/tenants/T";

export function fakeVisitsActions(over: Partial<Record<keyof VisitsActions, ReturnType<typeof vi.fn>>> = {}) {
  const ok = (message: string) => vi.fn(async () => ({ ok: true as const, message }));
  const actions = {
    book: over.book ?? ok("Booked: Priya S., Wed 14 Oct, 11:00. Nothing was sent to the customer. Confirm the visit when the customer agrees."),
    move: over.move ?? ok("Moved to Thu 15 Oct, 12:00. It waits for the customer to confirm again. Nothing was sent."),
    confirm: over.confirm ?? ok("Confirmed for Priya S., and nothing was sent to the customer."),
    arrive: over.arrive ?? ok("Priya S. is marked as here."),
    noShow: over.noShow ?? ok("Priya S. is marked as did not come."),
    cancel: over.cancel ?? ok("Cancelled for Priya S., and nothing was sent to the customer."),
    complete: over.complete ?? ok("Priya S.: done."),
    slots: over.slots ?? vi.fn(async (date: string) => ({ ok: true as const, slots: slotsJson(date) })),
    customers: over.customers ?? vi.fn(async () => ({ ok: true as const, items: [{ leadId: "c5c78ed6-e536-46af-a5c3-872bb2d844a2", label: "Sri Lakshmi Silks", city: "Hyderabad" }] })),
    saveHours: over.saveHours ?? vi.fn(async (s: unknown) => ({ ok: true as const, message: "Hours saved. Visits already booked were not changed.", settings: { ...SETTINGS, ...(s as object), is_default: false } })),
  };
  return actions as unknown as VisitsActions & Record<keyof VisitsActions, ReturnType<typeof vi.fn>>;
}
