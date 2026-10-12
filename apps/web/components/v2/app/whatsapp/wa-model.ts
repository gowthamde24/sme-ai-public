import type { ConnectionState, ThreadItem } from "@/lib/api/whatsapp";

import type { Say } from "../words";

/** The pure parts of the WhatsApp screens (job CC, screen 5). */
export const STATE_TONE: Record<ConnectionState, "neutral" | "amber" | "green" | "red"> = { not_connected: "neutral", connecting: "amber", connected: "green", needs_attention: "red" };
export const STATE_MOOD: Record<ConnectionState, "idle" | "thinking" | "answering" | "resting"> = { not_connected: "resting", connecting: "thinking", connected: "answering", needs_attention: "resting" };
export const WA_CODES = ["whatsapp_unavailable", "whatsapp_not_configured", "validation_error"] as const;
export const waSentence = (code: string, t: Say): string | null => ((WA_CODES as readonly string[]).includes(code) ? t(`wa.err.${code}`) : null);

/** The ids as WhatsApp's console shows them: digits only (the API checks again). */
export const DIGITS = /^\d{5,40}$/;
export const SECRET_NAME = /^[A-Za-z0-9_-]{1,80}$/;
export function accountProblem(f: { wabaId: string; phoneNumberId: string; tokenRef: string }): "waba" | "phone" | "token" | null {
  if (!DIGITS.test(f.wabaId.trim())) return "waba";
  if (!DIGITS.test(f.phoneNumberId.trim())) return "phone";
  if (!SECRET_NAME.test(f.tokenRef.trim())) return "token";
  return null;
}

/** The chat shows the oldest message first; the API sends the newest first. */
export const chronological = (items: readonly ThreadItem[]): ThreadItem[] => [...items].sort((a, b) => a.at.localeCompare(b.at));

/** Where an outgoing message stands, as one of our words: the delivery report when there is one, else the outbox state. */
export function outState(m: Pick<ThreadItem, "status" | "delivery">): "waiting" | "queued" | "sent" | "delivered" | "read" | "blocked" | "failed" {
  if (m.delivery === "failed") return "failed";
  if (m.delivery === "read") return "read";
  if (m.delivery === "delivered") return "delivered";
  if (m.status === "needs_approval") return "waiting";
  if (m.status === "queued") return "queued";
  if (m.status === "blocked") return "blocked";
  if (m.status === "failed") return "failed";
  return "sent";
}
export const OUT_TONE = { waiting: "amber", queued: "info", sent: "green", delivered: "green", read: "green", blocked: "red", failed: "red" } as const;

/** The closed words the API gives for why a delivery failed or a send failed (kept to letters and underscores); anything else is the generic sentence. */
export const DELIVERY_ERRORS = ["window_closed", "unreachable", "not_delivered_health", "rate_limited", "spam_limited", "opted_out_marketing", "token_expired", "other_error"] as const;
export const FAILURE_CODES = ["adapter_error", "timeout", "rejected", "window_closed", "template_required", "recipient_unreachable", "rate_limited", "not_configured"] as const;
export function failureWord(m: Pick<ThreadItem, "delivery_error" | "failure_code">, t: Say): string | null {
  if (m.delivery_error) return (DELIVERY_ERRORS as readonly string[]).includes(m.delivery_error) ? t(`wa.derr.${m.delivery_error}`) : t("wa.derr.other_error");
  if (m.failure_code) return (FAILURE_CODES as readonly string[]).includes(m.failure_code) ? t(`wa.fcode.${m.failure_code}`) : t("wa.derr.other_error");
  return null;
}

export const LANGS = ["en", "te", "hi", "kn", "ta"] as const;
