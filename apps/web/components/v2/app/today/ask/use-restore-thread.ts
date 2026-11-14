"use client";

import * as React from "react";

import { listHistory, openHistory } from "./conversation-api";
import type { AskSession } from "./use-ask-session";

/**
 * The thread is still there after a reload or on another device (owner, 14 Nov: one persistent conversation, stored per person on the server): once, when the page's conversation is empty, the most recent conversation is
 * opened and the next message continues it. Never over a conversation that is already going on in this tab, and never twice. "New chat" starts a fresh one; the earlier ones are listed.
 */
export function useRestoreThread(session: AskSession | null) {
  const done = React.useRef(false);
  const ready = session !== null;
  const sessionRef = React.useRef(session);
  React.useEffect(() => {
    sessionRef.current = session;
  });
  React.useEffect(() => {
    if (done.current || !ready) return;
    const s = sessionRef.current;
    if (!s) return;
    done.current = true;
    if (s.earlier.length > 0 || s.phase !== "idle" || s.conversationId() !== null) return;
    void (async () => {
      const items = await listHistory(s.base);
      const last = items && items.length > 0 ? items[0] : null;
      if (!last) return;
      const thread = await openHistory(s.base, last.id);
      const now = sessionRef.current;
      // somebody typed or spoke while this was loading: that conversation wins
      if (!thread || thread.length === 0 || !now || now.earlier.length > 0 || now.phase !== "idle" || now.conversationId() !== null) return;
      now.newChat(last.id, thread);
    })();
  }, [ready]);
}
