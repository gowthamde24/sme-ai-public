/**
 * What the cards on Today ask of the server and what they get back. The functions are server actions bound to the workspace (app/app/tenants/[tenantId]/today-actions.ts); the cards only see
 * this shape, so a test hands them plain functions. A result carries OUR sentence (never text from the API): `message` for the toast of a success, `error` for a refusal, with `mfa` when the
 * second factor is missing (the card then offers the way to the Security page) and `stale` when the card is out of date (the page is read again).
 */
export type DecisionResult = { ok: true; message: string; /** edit only: the words as they now are */ text?: string } | { ok: false; error: string; mfa?: boolean; stale?: boolean };

export type TodayActions = {
  approveMessage: (id: string) => Promise<DecisionResult>;
  rejectMessage: (id: string) => Promise<DecisionResult>;
  editMessage: (id: string, text: string) => Promise<DecisionResult>;
  approveCall: (id: string) => Promise<DecisionResult>;
  /** "Offer a store visit": the call is not approved and the Owner's choice is saved with the request. */
  offerVisit: (id: string) => Promise<DecisionResult>;
};
