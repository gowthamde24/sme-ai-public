"use client";

import * as React from "react";

import { onWake } from "./ask-wake";
import type { AskSession } from "./use-ask-session";

/** The restore that is running now (null = none): a first message waits for it a moment so it goes on in the same conversation (see `restoreSettled`). */
let running: Promise<void> | null = null;

/** Resolves when the earlier conversation has been read and put in the thread (at once when nothing is loading); never longer than `ms`, so a slow read never holds a message back. */
export function restoreSettled(ms = 1500): Promise<void> | null {
  const r = running;
  if (r === null) return null;
  return Promise.race([r, new Promise<void>((done) => setTimeout(done, ms))]);
}

/**
 * A reload or a new tab starts a NEW chat (owner, 19 Nov: it reversed his 14 Nov "one persistent conversation"): the box is empty and the last conversation is one of the "Earlier conversations". Nothing is lost: when the last
 * conversation still has a plan waiting for his answer, a small "Continue: <first line> ›" chip is offered at the top of the new chat (`resumable`; it is NOT reopened by itself). In-app navigation keeps the session's
 * conversation (the session lives in the workspace layout), so only a full load starts fresh. Never twice; never when something is already going on in this tab.
 * `enabled` (perf fix b, ask-wake.ts): false until the person first uses the composer or the orb, or the browser has been idle for 4 s after load; before that nothing is read. The conversation's API calls are a chunk of their own that arrives with the first read.
 */
export function useRestoreThread(session: AskSession | null, enabled = true) {
  const done = React.useRef(false);
  const ready = session !== null;
  const sessionRef = React.useRef(session);
  React.useEffect(() => {
    sessionRef.current = session;
  });
  const start = React.useCallback(() => {
    if (done.current) return;
    const s = sessionRef.current;
    if (!s) return;
    done.current = true;
    if (s.earlier.length > 0 || s.phase !== "idle" || s.conversationId() !== null) return;
    const run = (async () => {
      const { listHistory, openHistory } = await import("./conversation-api");
      const items = await listHistory(s.base);
      const last = items && items.length > 0 ? items[0] : null;
      if (!last) return;
      const thread = await openHistory(s.base, last.id);
      const now = sessionRef.current;
      // somebody typed or spoke while this was loading: that conversation wins
      if (!thread || thread.length === 0 || !now || now.earlier.length > 0 || now.phase !== "idle" || now.conversationId() !== null) return;
      // only a plan still waiting for his answer is worth a chip; everything else is simply an earlier conversation
      const waiting = thread.some((x) => x.plan && x.plan.status === "proposed");
      if (waiting) now.setResumable({ id: last.id, title: (last.title || last.lastText || thread[0]?.asked || "").slice(0, 60), thread });
    })();
    const mine: Promise<void> = run.catch(() => undefined).finally(() => {
      if (running === mine) running = null;
    });
    running = mine;
  }, []);
  // started by the render that follows the wake (or at once when `enabled` from the start), and in the very call of the wake when that is the first use, so a message sent right then can wait for it
  React.useEffect(() => {
    if (enabled && ready) start();
  }, [ready, enabled, start]);
  React.useEffect(() => onWake(start), [start]);
}
