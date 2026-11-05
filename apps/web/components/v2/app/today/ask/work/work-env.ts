import type { Say } from "../../../words";
import type { WorkTransport } from "@/lib/assistant-work/client";

import type { WorkStore } from "./work-store";

/** The member's role in this workspace, as the API reports it. The cards use it only to say "Only the owner can approve this"; the API checks again. */
export type WorkRole = "owner" | "admin" | "sales" | "viewer";

/** What every work card needs: its words (the chat's `bv.work.*`), the person's role, the side calls, the per-chat memory of each card, and a way to put text in the composer ("Change"). */
export type WorkEnv = {
  t: Say;
  role: WorkRole;
  transport: WorkTransport;
  store: WorkStore;
  /** "Change": the composer gets this text and the focus; the plan waits until the next message changes it. */
  onChange: (text: string) => void;
};

export const cardBox = "mt-2 rounded-xl border border-brand-edge bg-surface p-3";
export const btnDo = "inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-brand-edge bg-brand px-4 text-base font-semibold text-on-brand disabled:opacity-60";
export const btnOther = "inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-edge bg-surface px-4 text-base font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";
export const btnSmall = "inline-flex min-h-11 items-center justify-center rounded-full border border-edge bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";
