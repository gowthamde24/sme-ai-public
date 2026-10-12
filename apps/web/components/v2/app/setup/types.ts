import type { StoreSettings } from "@/lib/api/visits";

/**
 * What the screen knows about a workspace's setup (job BJ), all read from the API with the Owner's own token. A part that could not be read is null: nothing is guessed, and a workspace whose facts are unknown is
 * never treated as brand new (the wizard is not shown on a failed read).
 */
export type SetupFacts = {
  shop: string;
  /** The shop hours: `saved` = the business has saved its own (the API's `is_default` is false). */
  hours: { settings: StoreSettings; saved: boolean } | null;
  /** How many sarees the catalogue has (at most the number asked for: 0 or 1+). */
  sarees: number | null;
  /** Automatic sending and the quiet hours, as the API says. */
  sending: { auto: boolean; quietStart: number; quietEnd: number; platformOn: boolean } | null;
  /** Members of the workspace (a count): used only to say there is no invitation API yet. */
  members: number | null;
};

export type SetupActions = {
  saveHours: (settings: Omit<StoreSettings, "is_default">) => Promise<{ ok: true; message: string; settings: StoreSettings } | { ok: false; error: string }>;
  saveItem: (itemId: string, input: import("@/components/v2/app/catalogue/catalogue-types").SaveInput) => Promise<import("@/components/v2/app/catalogue/catalogue-types").ItemOutcome>;
};

export type SetupWords = Readonly<Record<string, string>>;
