import type { Conversation, ThreadItem } from "@/lib/api/whatsapp";

/**
 * Who is handling a chat (design system v6, owner 13 Nov 2026): the chat list says, on each row, "Reply ready for you", "Answered by assistant", "Needs you" or how it ended. C1 is adding `handled_by`, `assistant_enabled` and `reply_ready` to `GET /conversations`;
 * until the API sends them the web works it out from what the list already has plus the outbox's waiting replies. This is the one place that mapping lives, so the rows, the filters and their counts always agree. Pure.
 *
 * THE MAPPING (the API's word always wins; the rest only when it is absent), first that applies:
 *   a reply of the assistant waits for the owner's OK (an outbox message with status needs_approval for this chat, or `reply_ready`)  -> reply_ready
 *   the customer asked us to stop                                              -> done
 *   `handled_by` needs_you                                                     -> needs_you
 *   `handled_by` done or owner                                                 -> done      (a person finished it)
 *   `handled_by` assistant                                                     -> assistant
 *   an `outcome` word (visit_booked ...)                                       -> done      (said with that outcome)
 *   the assistant is switched off for this chat and the customer wrote last    -> needs_you
 *   the customer wrote last                                                    -> needs_you (nobody has answered yet)
 *   we wrote last                                                              -> assistant (answered)
 */
export const HANDLING = ["reply_ready", "needs_you", "assistant", "done"] as const;
export type Handling = (typeof HANDLING)[number];
export const CHAT_FILTERS = ["all", "needs_you", "assistant", "done"] as const;
export type ChatFilter = (typeof CHAT_FILTERS)[number];

export const parseChatFilter = (v: string | string[] | undefined): ChatFilter => {
  const x = Array.isArray(v) ? v[0] : v;
  return (CHAT_FILTERS as readonly string[]).includes(x ?? "") ? (x as ChatFilter) : "all";
};

export type Row = Handling | null;
export function chatHandling(c: Pick<Conversation, "last_direction" | "stopped" | "handledBy" | "assistantEnabled" | "replyReady" | "outcome">, replyWaiting: boolean): { state: Handling; outcome: string | null } {
  if (replyWaiting || c.replyReady) return { state: "reply_ready", outcome: null };
  if (c.stopped) return { state: "done", outcome: null };
  if (c.handledBy === "needs_you") return { state: "needs_you", outcome: null };
  if (c.handledBy === "owner" || c.handledBy === "done") return { state: "done", outcome: c.outcome ?? null };
  if (c.handledBy === "assistant") return { state: "assistant", outcome: null };
  if (c.outcome) return { state: "done", outcome: c.outcome };
  return { state: c.last_direction === "in" ? "needs_you" : "assistant", outcome: null };
}

/** Which filter a state belongs to: "Needs you" holds both the waiting replies and the chats nobody has answered. */
export const inFilter = (state: Handling, filter: ChatFilter): boolean => filter === "all" || (filter === "needs_you" ? state === "reply_ready" || state === "needs_you" : state === filter);

export function filterCounts(states: readonly Handling[]): Record<ChatFilter, number> {
  return { all: states.length, needs_you: states.filter((s) => inFilter(s, "needs_you")).length, assistant: states.filter((s) => s === "assistant").length, done: states.filter((s) => s === "done").length };
}

/** Who made a bubble: the API's `by`; when it says nothing, an outgoing message is the assistant's (it writes the replies; the owner's own go through the same outbox and are marked `owner` by the API). */
export const sentByAssistant = (m: Pick<ThreadItem, "direction" | "by">): boolean => m.direction === "out" && (m.by ?? "assistant") === "assistant";

/** The assistant's switch for one chat: the owner's choice (kept in the browser's cookie while the API has no way to save it) wins over what the API says; no word anywhere = on. */
export function assistantOn(apiSays: boolean | null | undefined, offHere: readonly string[], leadId: string): boolean {
  if (offHere.includes(leadId)) return false;
  return apiSays ?? true;
}
