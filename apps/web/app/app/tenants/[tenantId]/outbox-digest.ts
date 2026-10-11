import { summariseOutbox } from "@/components/v2/app/today/digest";
import type { Digest } from "@/components/v2/app/today/types";
import { ApiRequestError } from "@/lib/api/client";
import { listOutboxMessages, type OutboxMessage } from "@/lib/api/outbox";

const PAGES = 3;
const DAY_MS = 24 * 3600_000;

/**
 * The last 24 hours of the outbox, boiled down, for the overnight line and "Done while you slept". Read with the person's own token. NEVER rejects: a person who may not read the log (403:
 * a Viewer) gets `none` and the two places are not drawn; anything else that goes wrong is `error` and each place says so. At most three pages of a hundred messages are read, newest first,
 * and reading stops at the first page that reaches back past 24 hours.
 */
export async function readDigest(accessToken: string, tenantId: string, now: () => number = Date.now): Promise<Digest> {
  const items: OutboxMessage[] = [];
  try {
    let after: string | null = null;
    for (let page = 0; page < PAGES; page += 1) {
      const got = await listOutboxMessages(accessToken, tenantId, { limit: 100, after });
      items.push(...got.items);
      const oldest = got.items.at(-1);
      if (got.next_cursor === null || oldest === undefined || Date.parse(oldest.created_at) < now() - DAY_MS) break;
      after = got.next_cursor;
    }
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 403 || error.code === "outbox_unavailable")) return { state: "none" };
    return { state: "error" };
  }
  return summariseOutbox(items, now());
}
