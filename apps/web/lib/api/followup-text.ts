/**
 * The follow-up refusals in plain words (T010 part 2, ADR 0022). ONE table, OUR wording: the API answers a refusal with a closed `code` and a closed `reason` and the screen shows the
 * sentence below for that pair, never the text the server sent. The sentences are the API's own fixed sentences (services/ai-api/app/followups/messages.py); a Python test pins the two tables
 * equal (tests/test_followups_web_pins.py), so a change on one side without the other fails the build.
 *
 * PRIVACY: a client is never told that ANOTHER person was erased by right and shared an identifier. The API shows `erased_key` as `key`; this module does the same if it ever meets the word, so
 * the sentence for an erased key does not exist here and cannot be shown.
 */
export const REFUSAL_TEXT: Record<string, Record<string, string>> = {
  contact_blocked: {
    contact: "This person has asked not to be contacted.",
    key: "This e-mail address or phone number is on the do-not-contact list.",
    erased: "This contact has been erased: nothing new can be recorded about them.",
    consent: "There is no recorded consent for this channel, or no address for it.",
    other: "This contact cannot be contacted.",
  },
  no_suppression_key: {
    "-": "This contact has no suppression key recorded yet, so it cannot be contacted. Recording keys for existing contacts is not available on any screen yet.",
  },
  no_followup_policy: { "-": "No follow-up policy is in force: the owner must publish one." },
  draft_state: {
    exists: "A draft for this follow-up already exists.",
    not_draft: "That draft is not waiting for approval.",
    not_approved: "That draft has not been approved yet.",
    closed: "That is already closed.",
    other: "That draft is not in a state that allows this.",
  },
  followup_stale: {
    "-": "Something changed since this draft was made (the touches, the policy, the contact or the suppression state). Make a new draft.",
  },
  not_due: {
    suppressed: "This lead is flagged do-not-contact, opted out or bounced: there is no follow-up.",
    replied: "The customer replied: a person takes over.",
    closed: "This lead is won or lost: there is no follow-up.",
    max_touches: "The policy's limit of touches is reached.",
    initial_outreach: "There is no first message yet: the first message is a person's. Record it, then follow-ups can start.",
    future_history: "A touch is recorded after now: wait until it has passed.",
    not_yet: "It is not time for the next follow-up yet.",
    invalid: "The follow-up rules could not read this lead's state.",
    other: "No follow-up is due.",
  },
  followup_mismatch: {
    "-": "This follow-up does not match the database's own recomputation. Nothing was changed: try again.",
  },
  followup_stopped: {
    order_accepted: "An order for this lead was accepted: follow-ups stop.",
    order_declined: "An order for this lead was declined: follow-ups stop.",
    order_cancelled: "An order for this lead was cancelled: follow-ups stop.",
    quote_withdrawn: "The quote for this lead was withdrawn: follow-ups stop.",
    lead_archived: "This lead is archived: follow-ups stop.",
    other: "Follow-ups are stopped for this lead.",
  },
  not_your_draft: { "-": "Only the person who made this draft, an Admin or the Owner can discard it." },
  followup_limit: { "-": "This lead has reached the limit of recorded touches." },
};

/** What the person sees when the second factor is missing: the same sentence the order screens show. */
export const MFA_TEXT = "This needs your authenticator app. Set it up on the Security page, sign in again with its code, and try once more.";
export const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";

/** Refusals after which what is on the screen is out of date: the page is read again (the person sees the new state, never a guess). */
export const STALE_CODES: readonly string[] = ["followup_stale", "followup_mismatch", "draft_state", "not_due", "followup_stopped", "contact_blocked", "conflict"];

/** The reason a client may use: `erased_key` is `key`, anything else outside the table is `other`. */
function clientReason(code: string, reason: string | undefined): string {
  const table = REFUSAL_TEXT[code];
  if (!table) return "other";
  if (Object.keys(table).includes("-")) return "-";
  const wanted = reason === "erased_key" ? "key" : (reason ?? "other");
  return wanted in table ? wanted : "other";
}

/**
 * ONE fixed sentence for a refusal of the API. Unknown codes fall back to a sentence chosen by the HTTP status; nothing the server wrote is ever returned.
 * (The caller passes the status, the closed code and the closed reason: `ApiRequestError.status`, `.code`, `.reason`.)
 */
export function followupSentence(status: number, code: string, reason?: string): string {
  if (code === "mfa_required") return MFA_TEXT;
  if (REFUSAL_TEXT[code]) return REFUSAL_TEXT[code][clientReason(code, reason)];
  switch (code) {
    case "conflict":
      return OUT_OF_DATE;
    case "followups_unavailable":
    case "followup_cadence_unavailable":
      return "Follow-ups are not available right now. Try again shortly.";
    case "followup_cadence_failed":
      return "The follow-up rules could not be run. Nothing was recorded.";
    case "invalid_value":
    case "validation_error":
      return "That input was not accepted.";
    case "forbidden":
      return "Your role does not allow this.";
    case "not_found":
      return "This is not available.";
  }
  if (status === 403) return "Your role does not allow this.";
  if (status === 404) return "This is not available.";
  if (status === 503) return "Follow-ups are not available right now. Try again shortly.";
  if (status === 409) return "That is not possible right now. Reload the page and try again.";
  if (status === 422) return "That input was not accepted.";
  return "Could not save. Try again.";
}

export const GATE_TEXT: Record<string, string> = {
  contact: REFUSAL_TEXT.contact_blocked.contact,
  key: REFUSAL_TEXT.contact_blocked.key,
  erased: REFUSAL_TEXT.contact_blocked.erased,
  consent: REFUSAL_TEXT.contact_blocked.consent,
  unkeyed: REFUSAL_TEXT.no_suppression_key["-"],
};
export const STOPPED_TEXT: Record<string, string> = {
  order_accepted: REFUSAL_TEXT.followup_stopped.order_accepted,
  order_declined: REFUSAL_TEXT.followup_stopped.order_declined,
  order_cancelled: REFUSAL_TEXT.followup_stopped.order_cancelled,
  quote_withdrawn: REFUSAL_TEXT.followup_stopped.quote_withdrawn,
  lead_archived: REFUSAL_TEXT.followup_stopped.lead_archived,
};

/**
 * What the pinned engine said, in our words (guidance only: the database decides again when a draft is asked for). The keys are the engine's `reason_code`s and, for a rejection of the request,
 * its closed rejection codes.
 */
export const DECISION_TEXT: Record<string, string> = {
  ...STOPPED_TEXT, // the database's own stops (an accepted order ...): the API answers `stop` with that reason for a stopped lead
  eligible_now: "A follow-up draft can be made now.",
  not_yet_eligible: "It is not time for the next follow-up yet.",
  do_not_contact: "This lead is flagged do-not-contact: no follow-up.",
  opted_out: "This lead opted out: no follow-up.",
  bounced: "A message to this lead bounced: no follow-up.",
  human_takeover: "The customer replied: a person takes over.",
  won: "This lead is won: no follow-up.",
  lost: "This lead is lost: no follow-up.",
  max_touches_reached: "The policy's limit of touches is reached.",
  initial_outreach_required: "There is no first message yet: the first message is a person's. Record it, then follow-ups can start.",
  FUTURE_HISTORY: "A touch is recorded after now: wait until it has passed.",
};
export const DECISION_FALLBACK = "The follow-up rules could not give an answer for this lead.";
