import { ApiAuthError } from "@/lib/api/client";
import { listActivityLog, type LogKind } from "@/lib/api/activity-log";
import { readActivity } from "@/lib/assistant-work/source";
import type { ScreenMode } from "@/lib/screens/flag";

import { fromAction, fromLog, merge, type Entry, type Kind } from "./model";

/**
 * The sources of "Everything it did": each is one read that gives entries and may fail on its own (a source that cannot be read is named in `missing`, "Not shown yet", never guessed). They read C1's `GET /activity-log` one kind at a
 * time; to take another timeline in, change SOURCES. With ASSISTANT_WORK_SCREENS=mock the assistant's changes are the made-up day ("Example data"); the calls and messages are still the API's.
 */
type Ctx = { token: string; tenantId: string };
type Source = { kind: Kind; read: (ctx: Ctx, now: number, mode: Exclude<ScreenMode, "off">) => Promise<Entry[] | null> };
const ofKind = (kind: LogKind) => async (ctx: Ctx): Promise<Entry[]> => (await listActivityLog(ctx.token, ctx.tenantId, { kind, limit: 50 })).items.map(fromLog);
export const SOURCES: readonly Source[] = [
  { kind: "changes", read: async (ctx, now, mode) => (mode === "mock" ? ((await readActivity("mock", ctx, "week", now))?.map(fromAction) ?? null) : ofKind("action")(ctx)) },
  { kind: "calls", read: (ctx) => ofKind("call")(ctx) },
  { kind: "messages", read: (ctx) => ofKind("message")(ctx) },
];

export type Everything = { entries: Entry[]; missing: Kind[]; /** the assistant's actions came from the made-up day (ASSISTANT_WORK_SCREENS=mock) */ example: boolean };

export async function readEverything(ctx: Ctx, mode: ScreenMode, now: number = Date.now()): Promise<Everything> {
  const m = mode === "mock" ? "mock" : "on";
  const results = await Promise.allSettled(SOURCES.map((s) => s.read(ctx, now, m)));
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
