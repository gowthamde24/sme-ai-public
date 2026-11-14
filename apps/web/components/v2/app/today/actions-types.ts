/**
 * What the cards on Today ask of the server and what they get back. The functions are server actions bound to the workspace (app/app/tenants/[tenantId]/today-actions.ts); the cards only see
 * this shape, so a test hands them plain functions. A result carries OUR sentence (never text from the API): `message` for the toast of a success, `error` for a refusal, with `mfa` when the
 * second factor is missing (the card then offers the way to the Security page) and `stale` when the card is out of date (the page is read again).
 */
import type { AskHow, AskOutcome } from "@/lib/api/ask-consent";
import type { OutboxLanguage } from "@/lib/api/outbox";

import type { ProposalActions } from "../visits/actions-types";

export type DecisionResult = { ok: true; message: string; /** edit only: the words as they now are */ text?: string } | { ok: false; error: string; mfa?: boolean; stale?: boolean };

export type TodayActions = {
  approveMessage: (id: string) => Promise<DecisionResult>;
  rejectMessage: (id: string) => Promise<DecisionResult>;
  editMessage: (id: string, text: string) => Promise<DecisionResult>;
  approveCall: (id: string) => Promise<DecisionResult>;
  /** "Offer a store visit" (job AS): the call is declined and a message offering a visit goes to the outbox, in the language of the request. */
  offerVisit: (id: string, language: OutboxLanguage) => Promise<DecisionResult>;
  /** Confirm, move or cancel a visit Agent OWL proposed (and the free times to move it to). null: the cards offer no buttons. */
  visit: ProposalActions | null;
  /** A Lead Finder business on its row (owner, 5 Nov), as on the Prospects page: Call = the Owner's yes (it becomes ready to call and its practice call opens: nothing is dialled), Skip. Absent or null: the rows offer no buttons. */
  prospect?: { call: (id: string) => Promise<DecisionResult>; skip: (id: string) => Promise<DecisionResult> } | null;
  /** "Done" on a caller who asked for a person or agreed a visit (C1 #347, #354): the team called back. Optional: a screen without it offers no Done. */
  callHandled?: (id: string) => Promise<DecisionResult>;
  /** "Ask first" on a plan that left out people whose consent is unknown (the Owner; owner, 14 Nov): ask them on WhatsApp, or confirm they agreed; or close the item. Absent or null: the card shows no buttons. */
  askFirst?: { ask: (taskId: string, how: AskHow) => Promise<AskOutcome>; dismiss: (taskId: string) => Promise<{ ok: boolean }> } | null;
};
