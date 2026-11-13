import type { CallRow, CallStatusWord } from "@/lib/api/calls";

/**
 * The Calls page of design system v6 (owner, 13 Nov 2026): each call has ONE status (Completed, Transferred, No answer, Rejected, Spam, Live) and ONE sentence about what happened. C1 is adding both to `GET /calls` (`status`, `outcome_sentence`);
 * until the API sends them the web derives them from what the call has already (`state`, `outcome`, `category`, `summary_short`, `refuse_reason`, `end_reason`). This file is the one place that mapping lives, so the table, the chips, the counts and
 * the panel always agree. Pure: no request, no words (the sentence parts are keys and values; the page says them in the person's language).
 *
 * THE MAPPING (an API status always wins; the rest is only used when it is absent):
 *   live                                            -> live        (ringing or on the line)
 *   refused, reason blocked_caller                  -> spam        (the caller is on the block list)
 *   refused, any other reason                       -> rejected    (the gate did not let the call happen)
 *   completed and it ended in a hand-over (end_reason handover)                         -> transferred
 *   completed                                       -> completed
 *   no_answer, busy, voicemail, failed, cancelled, queued (nobody talked to the assistant) -> no_answer
 */
export const STATUS_ORDER: readonly CallStatusWord[] = ["completed", "transferred", "no_answer", "rejected", "spam", "live"];

type Statusable = Pick<CallRow, "state" | "live" | "status" | "refuseReason" | "endReason">;

export function callStatus(c: Statusable): CallStatusWord {
  if (c.status) return c.status;
  if (c.live) return "live";
  if (c.state === "refused") return c.refuseReason === "blocked_caller" ? "spam" : "rejected";
  if (c.state === "completed") return c.endReason === "handover" ? "transferred" : "completed";
  return "no_answer";
}

/** How many calls are in each status, plus the total ("all"). Every status is present (0 when none), so the chips never jump. */
export function statusCounts(calls: readonly Statusable[]): Record<CallStatusWord | "all", number> {
  const out: Record<CallStatusWord | "all", number> = { all: calls.length, completed: 0, transferred: 0, no_answer: 0, rejected: 0, spam: 0, live: 0 };
  for (const c of calls) out[callStatus(c)] += 1;
  return out;
}

/**
 * What happened, as a sentence. The API's own `outcome_sentence` is used when it sends one (English, its words). Otherwise, the first that applies:
 *   1. a refused call: "not called" with the reason (kind "refused", the page says it with ph.refused / ph.why.*)
 *   2. the call's short summary (the assistant's one line, at most 140 characters)
 *   3. the category the call came to ("Visit booked", "Interested" ...: outcome.cat.*)
 *   4. the plain result (positive / negative / unclear: outcome.result.*)
 *   5. what the state says (no answer, busy, voicemail, failed, cancelled, in progress ...: ph.state.*)
 */
export type Sentence =
  | { kind: "api"; text: string }
  | { kind: "refused"; reason: string | null }
  | { kind: "summary"; text: string }
  | { kind: "category"; category: string }
  | { kind: "result"; result: string }
  | { kind: "state"; state: string };

export function callSentence(c: Pick<CallRow, "state" | "live" | "outcomeSentence" | "summaryShort" | "category" | "outcome" | "refuseReason">): Sentence {
  if (c.outcomeSentence) return { kind: "api", text: c.outcomeSentence };
  if (c.state === "refused") return { kind: "refused", reason: c.refuseReason };
  if (c.summaryShort) return { kind: "summary", text: c.summaryShort };
  if (c.category) return { kind: "category", category: c.category };
  if (c.outcome === "positive" || c.outcome === "negative" || c.outcome === "unclear") return { kind: "result", result: c.outcome };
  return { kind: "state", state: c.state };
}

type W = Readonly<Record<string, string>>;
/** The sentence in words. `why(reason)` is the page's own plain-words reason for a refused call (lib/calls/view.ts refuseWhy + ph.why.*). */
export function sentenceText(s: Sentence, w: W, why: (reason: string | null) => string): string {
  switch (s.kind) {
    case "api":
    case "summary":
      return s.text;
    case "refused":
      return (w["ph.refused"] ?? "{why}").replace("{why}", why(s.reason));
    case "category":
      return w[`outcome.cat.${s.category}`] ?? w[`ph.cat.${s.category}`] ?? "";
    case "result":
      return w[`outcome.result.${s.result}`] ?? "";
    case "state":
      return w[`ph.state.${s.state}`] ?? "";
  }
}
