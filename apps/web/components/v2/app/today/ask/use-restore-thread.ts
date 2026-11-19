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
 * The thread is still there after a reload or on another device (owner, 14 Nov: one persistent conversation, stored per person on the server): once, when the page's conversation is empty, the most recent conversation is
 * opened and the next message continues it. Never over a conversation that is already going on in this tab, and never twice. "New chat" starts a fresh one; the earlier ones are listed.
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
      now.newChat(last.id, thread);
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
