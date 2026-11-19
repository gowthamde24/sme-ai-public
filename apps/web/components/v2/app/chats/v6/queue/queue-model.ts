import type { QueuedMessage } from "@/lib/api/chat-queue";

/**
 * What the composer of a chat with a closed 24 hour window shows (owner, 19 Nov 2026), as a pure function of the queued message the API sent and of what the person just did on this screen. Nothing here reads the network. The API's words are mapped to ONE of these views, and every
 * view has all its sentences as keys (`chats6.q.*`), so no English note ever sits above a Telugu button.
 *   idle      nothing queued: the box, the help line and "Call instead"
 *   waiting   `waiting_for_reply`: "Will send when they reply" + Cancel (+ Call instead)
 *   sending   `sending` (and the old `replied_waiting_for_morning`, and a word this screen does not know): "Sending…"
 *   sent      `sent` seen on this screen: "Your message was sent"
 *   failed    `failed`: a plain sentence + Try again
 *   expired   `expired` (7 days without a reply): not sent, Call instead + Write again
 *   stopped   the customer said STOP (`cancelled` with failure_code stopped_by_customer, or a 409 stopped_by_customer): not sent, no call either
 *   hello     the hello cannot go (continue_chat not_approved, or a 409 consent_required): said at once, Call instead, the words stay in the box
 * `cancelled` by the person is not a view: the box is back, quietly, with the words.
 */
export type QView = "idle" | "waiting" | "sending" | "sent" | "failed" | "expired" | "stopped" | "hello";
/** What the person's own last move left on this screen (never from the API): a hello that cannot go, a STOP told at the send, a message seen going out. */
export type Local = "hello" | "stopped" | "sent" | null;

/** The views in which the words in the box are the queued message's and cannot be changed. */
export const READ_ONLY: readonly QView[] = ["waiting", "sending", "failed", "expired", "stopped"];
/** The views in which the person may send what is in the box. */
// (not in "hello": the hello cannot go, so Send stays off and "Call instead" is the action)
export const CAN_SEND: readonly QView[] = ["idle", "sent"];
/** The views that still change by themselves (the poll goes on; in the others it only watches for a message made on another device). */
export const LIVE: readonly QView[] = ["waiting", "sending"];

export const isStop = (q: QueuedMessage): boolean => q.status === "cancelled" && q.failureCode === "stopped_by_customer";
/** A message that went, or that the person cancelled: the chat shows the box again (the thread has the sent message). A STOP stays: it says why nothing went. */
export const isEnded = (q: QueuedMessage): boolean => q.status === "sent" || (q.status === "cancelled" && !isStop(q));

export function viewOf(q: QueuedMessage | null, local: Local, dismissed: string | null = null): QView {
  if (local === "hello" || local === "stopped") return local;
  if (q && q.id !== dismissed) {
    if (isStop(q)) return "stopped";
    switch (q.status) {
      case "waiting_for_reply":
        return "waiting";
      case "failed":
        return "failed";
      case "expired":
        return "expired";
      case "sending":
        return "sending";
      case "sent":
        return local === "sent" ? "sent" : "idle";
      case "cancelled":
        return "idle";
    }
  }
  return local === "sent" ? "sent" : "idle";
}
/** The queued message as the page first shows it: one that ended is not shown again after a reload (the thread has it). */
export const firstShown = (q: QueuedMessage | null | undefined): QueuedMessage | null => (q && !isEnded(q) ? q : null);
