import { vi } from "vitest";

import { appDict } from "@/i18n/app";
import { parseOutboxMessage, type OutboxMessage } from "@/lib/api/outbox";
import { BLOCKED_JSON, PRICE_JSON, QUIET_JSON, SENT_JSON } from "@/lib/api/outbox-fixtures";
import { outboxWords } from "@/app/app/tenants/[tenantId]/outbox/outbox-words";

import type { OutboxActions } from "./OutboxList";

/** Shared by the tests of the Outbox: English words, a pinned clock (Wednesday 14 October 2026, 10:00 in India) and one message of each state. Test code only. */
export const WORDS = outboxWords("en");
export const NOW = Date.parse("2026-10-14T04:30:00Z");
export const BASE = "/app/tenants/T";
void appDict;

export const msg = (json: Record<string, unknown>, over: Record<string, unknown> = {}): OutboxMessage => parseOutboxMessage({ ...json, ...over });
/** Waiting for a person: a price in Telugu, made at 08:42 today. */
export const WAITING = () => msg(PRICE_JSON, { created_at: "2026-10-14T03:12:00Z" });
/** Held for quiet hours: goes out at 9:00 tomorrow... shown relative to NOW (10:00): tomorrow 09:00 IST = 03:30Z on the 15th. */
export const HELD = () => msg(QUIET_JSON, { id: "11111111-aaaa-4aaa-8aaa-0000000000b4", scheduled_for: "2026-10-15T03:30:00Z", created_at: "2026-10-14T03:00:00Z" });
export const SENT = () => msg(SENT_JSON, { id: "11111111-aaaa-4aaa-8aaa-0000000000b2", sent_at: "2026-10-14T02:00:00Z", scheduled_for: "2026-10-14T02:00:00Z", created_at: "2026-10-14T01:59:00Z" });
export const STOPPED = () => msg(BLOCKED_JSON, { id: "11111111-aaaa-4aaa-8aaa-0000000000b3", reason: "stopped", reason_text: "The customer asked us to stop. Nothing more is sent.", created_at: "2026-10-13T16:00:00Z" });
export const FAILED = () => msg(BLOCKED_JSON, { id: "11111111-aaaa-4aaa-8aaa-0000000000b5", status: "failed", reason: "send_failed", reason_text: "The channel could not deliver it.", failure_code: "timeout", created_at: "2026-10-14T00:10:00Z" });

export function fakeOutboxActions(over: Partial<Record<keyof OutboxActions, ReturnType<typeof vi.fn>>> = {}) {
  const ok = (message: string) => vi.fn(async () => ({ ok: true as const, message }));
  return {
    approve: over.approve ?? ok("Sent to DEMO Lakshmi Textiles."),
    reject: over.reject ?? ok("Not sent. Nothing was sent to DEMO Lakshmi Textiles."),
    edit: over.edit ?? vi.fn(async (_id: string, text: string) => ({ ok: true as const, message: "Saved. Read it once more, then approve.", text })),
    dispatch: over.dispatch ?? ok("2 sent."),
    // the real history is read when a row opens; by default it is not available, so a row shows the history made from its own times
    detail: over.detail ?? vi.fn(async () => ({ ok: false as const })),
  } as unknown as OutboxActions & Record<keyof OutboxActions, ReturnType<typeof vi.fn>>;
}

import type { SchedulerStatus } from "@/lib/api/scheduler";
import { STATUS_JSON } from "@/lib/api/scheduler-fixtures";

export const schedulerStatusFor = (over: Partial<SchedulerStatus> = {}): SchedulerStatus => ({ ...(STATUS_JSON as SchedulerStatus), ...over });
