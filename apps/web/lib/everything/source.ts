import { ApiAuthError } from "@/lib/api/client";
import { listCalls } from "@/lib/api/calls";
import { listOutboxMessages } from "@/lib/api/outbox";
import { readActivity } from "@/lib/assistant-work/source";
import type { ScreenMode } from "@/lib/screens/flag";

import { fromAction, fromCall, fromMessage, merge, messagesOf, type Entry, type Kind } from "./model";

/**
 * The sources of "Everything it did": each is one read that gives entries and may fail on its own (a source that cannot be read is named in `missing`, "Not shown yet", never guessed). When C1 builds a server-side
 * `/activity-log`, it is one more entry in SOURCES and the three below go: nothing else in the page changes.
 */
type Ctx = { token: string; tenantId: string };
type Source = { kind: Kind; read: (ctx: Ctx, now: number, mode: Exclude<ScreenMode, "off">) => Promise<Entry[] | null> };
export const SOURCES: readonly Source[] = [
  { kind: "changes", read: async (ctx, now, mode) => (await readActivity(mode, ctx, "week", now))?.map(fromAction) ?? null },
  { kind: "calls", read: async (ctx) => (await listCalls(ctx.token, ctx.tenantId)).items.map(fromCall) },
  { kind: "messages", read: async (ctx) => messagesOf(await listOutboxMessages(ctx.token, ctx.tenantId, { limit: 50 })).map(fromMessage) },
];

export type Everything = { entries: Entry[]; missing: Kind[]; /** the assistant's actions came from the made-up day (ASSISTANT_WORK_SCREENS=mock) */ example: boolean };

export async function readEverything(ctx: Ctx, mode: Exclude<ScreenMode, "off"> | "off", now: number = Date.now()): Promise<Everything> {
  const m = mode === "off" ? "on" : mode;
  const results = await Promise.allSettled(SOURCES.map((s) => (s.kind === "changes" && mode === "off" ? Promise.resolve(null) : s.read(ctx, now, m))));
  const missing: Kind[] = [];
  const lists: Entry[][] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      if (r.reason instanceof ApiAuthError) throw r.reason;
      missing.push(SOURCES[i].kind);
    } else if (r.value === null) missing.push(SOURCES[i].kind);
    else lists.push(r.value);
  });
  return { entries: merge(lists, now), missing, example: mode === "mock" };
}
