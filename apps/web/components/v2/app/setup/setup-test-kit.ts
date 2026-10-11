import { setupWords } from "@/app/app/tenants/[tenantId]/setup-words";
import type { StoreSettings } from "@/lib/api/visits";

import type { SetupActions, SetupFacts } from "./types";

export const T = "11111111-1111-4111-8111-111111111111";
export const BASE = `/app/tenants/${T}`;
export const words = setupWords("en");

const DEFAULT_WEEK = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "10:00", close: "20:30" }])) as StoreSettings["weekly_hours"];
export const defaultHours: StoreSettings = { weekly_hours: DEFAULT_WEEK, closed_dates: [], slot_minutes: 30, max_parallel: 2, is_default: true };

/** A brand-new workspace: hours never saved, no saree. */
export const fresh = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  shop: "Asha Silks",
  hours: { settings: defaultHours, saved: false },
  sarees: 0,
  sending: { auto: false, quietStart: 21, quietEnd: 9, platformOn: true },
  members: 1,
  ...over,
});

export function actions(over: Partial<SetupActions> = {}): SetupActions & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    saveHours: async (s) => {
      saved.push(["hours", s]);
      return { ok: true, message: "Hours saved. Visits already booked were not changed.", settings: { ...s, is_default: false } };
    },
    saveItem: async (id, input) => {
      saved.push(["item", id, input]);
      return { ok: true, item: { id, ...input } as never };
    },
    ...over,
  };
}
