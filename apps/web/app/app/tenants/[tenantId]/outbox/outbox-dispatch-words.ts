import type { appT } from "@/i18n/app";
import type { DispatchResult } from "@/lib/api/outbox";

/** The sentence after "Send what is due now", in plain words, from what the API counted (job BB). Nothing is claimed that the answer does not say: a message is "sent" only if it is counted as sent. */
export function dispatchWords(r: DispatchResult, t: ReturnType<typeof appT>): string {
  if (r.platform_switch_on === false) return t("outbox.dr.stopped");
  const parts: string[] = [];
  if (r.sent > 0) parts.push(t("outbox.dr.sent", { n: r.sent }));
  if (r.failed > 0) parts.push(t("outbox.dr.failed", { n: r.failed }));
  if (r.retry_later > 0) parts.push(t("outbox.dr.retry", { n: r.retry_later }));
  if (r.still_due > 0) parts.push(t("outbox.dr.stilldue", { n: r.still_due }));
  if (r.held_for_later > 0) parts.push(t("outbox.dr.held", { n: r.held_for_later }));
  if (parts.length === 0) return t("outbox.dispatch.none");
  return parts.join(" ");
}
