import { describe, expect, it } from "vitest";

import { DECISION_FALLBACK, DECISION_TEXT, GATE_TEXT, MFA_TEXT, OUT_OF_DATE, REFUSAL_TEXT, STALE_CODES, STOPPED_TEXT, followupSentence } from "./followup-text";

const CANARY = "CANARY-7d2e61 secret server text";
const ALL: [string, string, string][] = Object.entries(REFUSAL_TEXT).flatMap(([code, table]) => Object.entries(table).map(([reason, text]): [string, string, string] => [code, reason, text]));

describe("every code and reason of the closed refusals has ONE fixed sentence", () => {
  it("the table has the ten codes of SM220-SM229, and every sentence is a non-empty sentence of ours", () => {
    expect(Object.keys(REFUSAL_TEXT).sort()).toEqual(
      ["contact_blocked", "draft_state", "followup_limit", "followup_mismatch", "followup_stale", "followup_stopped", "no_followup_policy", "no_suppression_key", "not_due", "not_your_draft"].sort(),
    );
    for (const [, , text] of ALL) expect(text).toMatch(/^[A-Z].*[.]$/);
  });

  it.each(ALL)("%s / %s shows its own sentence, whatever message the server sent", (code, reason, text) => {
    expect(followupSentence(409, code, reason === "-" ? undefined : reason)).toBe(text);
  });

  it("no two reasons of one code share a sentence (the person can tell them apart)", () => {
    for (const [code, table] of Object.entries(REFUSAL_TEXT)) {
      const texts = Object.values(table);
      expect(new Set(texts).size, code).toBe(texts.length);
    }
  });

  it("a reason outside the closed list shows the code's own 'other' sentence, never the reason", () => {
    for (const code of ["contact_blocked", "draft_state", "not_due", "followup_stopped"]) {
      expect(followupSentence(409, code, CANARY)).toBe(REFUSAL_TEXT[code].other);
      expect(followupSentence(409, code, undefined)).toBe(REFUSAL_TEXT[code].other);
    }
    expect(followupSentence(409, "followup_stale", CANARY)).toBe(REFUSAL_TEXT.followup_stale["-"]); // a code with no reasons ignores one
  });
});

describe("PRIVACY: another person who was erased by right is never mentioned, and erased_key can never appear", () => {
  it("an erased_key reason is shown as the sentence of `key`", () => {
    expect(followupSentence(409, "contact_blocked", "erased_key")).toBe(REFUSAL_TEXT.contact_blocked.key);
  });

  it("no sentence of any table mentions an erasure by right or an erased key", () => {
    const every = [...ALL.map(([, , t]) => t), ...Object.values(GATE_TEXT), ...Object.values(STOPPED_TEXT), ...Object.values(DECISION_TEXT), MFA_TEXT, OUT_OF_DATE, DECISION_FALLBACK];
    for (const text of every) {
      expect(text.toLowerCase()).not.toContain("by right");
      expect(text).not.toMatch(/erased[\s_-]*key/i);
    }
    expect(Object.keys(REFUSAL_TEXT.contact_blocked)).not.toContain("erased_key");
    expect(Object.keys(GATE_TEXT)).not.toContain("erased_key");
  });
});

describe("the other answers", () => {
  it("the second factor is the same sentence the order screens show", () => {
    expect(followupSentence(403, "mfa_required", undefined)).toBe(MFA_TEXT);
    expect(MFA_TEXT).toBe("This needs your authenticator app. Set it up on the Security page, sign in again with its code, and try once more.");
  });

  it("generic codes and statuses have fixed sentences and never repeat the server's text", () => {
    const answers = [
      followupSentence(409, "conflict"),
      followupSentence(503, "followups_unavailable"),
      followupSentence(503, "followup_cadence_unavailable"),
      followupSentence(502, "followup_cadence_failed"),
      followupSentence(422, "invalid_value"),
      followupSentence(422, "validation_error"),
      followupSentence(403, "forbidden"),
      followupSentence(404, "not_found"),
      followupSentence(403, "something_new"),
      followupSentence(404, "something_new"),
      followupSentence(503, "something_new"),
      followupSentence(409, "something_new"),
      followupSentence(422, "something_new"),
      followupSentence(500, "something_new", CANARY),
    ];
    for (const a of answers) {
      expect(a).not.toContain("CANARY");
      expect(a).toMatch(/^[A-Z].*[.]$/);
    }
    expect(followupSentence(409, "conflict")).toBe(OUT_OF_DATE);
  });

  it("the gate, the stops and the engine's reasons are all in closed words", () => {
    expect(Object.keys(GATE_TEXT).sort()).toEqual(["consent", "contact", "erased", "key", "unkeyed"]);
    expect(Object.keys(STOPPED_TEXT).sort()).toEqual(["lead_archived", "order_accepted", "order_cancelled", "order_declined", "quote_withdrawn"]);
    expect(Object.keys(DECISION_TEXT)).toContain("eligible_now");
    expect(Object.keys(DECISION_TEXT)).toContain("FUTURE_HISTORY");
  });

  it("a refusal after which the screen is out of date says so (the page is read again)", () => {
    for (const code of ["followup_stale", "followup_mismatch", "draft_state", "not_due", "followup_stopped", "contact_blocked"]) expect(STALE_CODES).toContain(code);
    expect(STALE_CODES).not.toContain("mfa_required");
    expect(STALE_CODES).not.toContain("not_your_draft");
  });
});
