import type { Slots, StoreSettings, VisitOutcome } from "@/lib/api/visits";

/**
 * What the Visits page and the visit cards on Today ask of the server and what they get back. The functions are server actions bound to the workspace (app/app/tenants/[tenantId]/visits/visits-actions.ts);
 * the screens only see this shape, so a test hands them plain functions. A result carries OUR sentence (never text from the API): `message` for a success, `error` for a refusal, with `mfa` when the
 * second factor is missing, `quotes` when "bought" found no approved quote (the card then points at the quotes), and `stale` when the screen is out of date (it is read again).
 */
export type StepResult = { ok: true; message: string; orderId?: string } | { ok: false; error: string; mfa?: boolean; quotes?: boolean; stale?: boolean };
export type SlotsResult = { ok: true; slots: Slots } | { ok: false; error: string };
export type CustomerHit = { leadId: string; label: string; city: string | null };
export type CustomersResult = { ok: true; items: CustomerHit[] } | { ok: false; error: string };
export type HoursResult = { ok: true; message: string; settings: StoreSettings } | { ok: false; error: string };

export type BookInput = { visitId: string; leadId: string; date: string; slot: string; partySize: number; purpose: string; note: string; advanceRupees: number | null };

export type VisitsActions = {
  book: (input: BookInput) => Promise<StepResult>;
  move: (id: string, date: string, slot: string) => Promise<StepResult>;
  confirm: (id: string) => Promise<StepResult>;
  arrive: (id: string) => Promise<StepResult>;
  noShow: (id: string) => Promise<StepResult>;
  cancel: (id: string, reason: string) => Promise<StepResult>;
  complete: (id: string, outcome: VisitOutcome, orderId: string | null) => Promise<StepResult>;
  slots: (date: string) => Promise<SlotsResult>;
  customers: (query: string) => Promise<CustomersResult>;
  saveHours: (settings: Omit<StoreSettings, "is_default">) => Promise<HoursResult>;
};

/** The part of the actions a card on Today needs: confirm, move, cancel a visit Agent OWL proposed, and the slots to move it to. */
export type ProposalActions = Pick<VisitsActions, "confirm" | "move" | "cancel" | "slots">;
