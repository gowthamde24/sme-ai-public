"use client";

import * as React from "react";

import type { LocalAnswer } from "../ask/ask-types";
import { useStoredAsk } from "../ask/ask-store";

/**
 * "Do it" for Today's v6 parts (the command bar, a suggested job, the phone): hands an instruction to the EXISTING plan-card flow of the workspace's shared conversation (plan, then Approve, then it runs, then Undo). The conversation is put into its "do" mode first
 * (where the person may make a plan), then asks; where it has no plan mode, the instruction is asked as a question. Nothing starts by itself: the plan card waits for the owner. `onSent` is called when an instruction has gone in (the input clears). `submit` is false when there is
 * no conversation to ask with (yet).
 */
export function usePlanSubmit(reply?: string, onSent?: () => void) {
  const session = useStoredAsk();
  const pending = React.useRef<{ q: string; ids?: readonly string[]; local?: LocalAnswer | null } | null>(null);
  const sent = React.useRef(onSent);
  React.useEffect(() => {
    sent.current = onSent;
  });
  const mode = session?.mode;
  const ask = session?.ask;
  // the switch to "do" arrives as the session's next state: the held instruction goes in then
  React.useEffect(() => {
    const held = pending.current;
    if (held === null || !ask || mode !== "do") return;
    pending.current = null;
    void ask(held.q, reply, held.ids, held.local);
    sent.current?.();
  }, [ask, mode, reply]);
  const submit = (raw: string, ids?: readonly string[], local?: LocalAnswer | null): boolean => {
    const q = raw.trim();
    if (!q || !session || !session.live) return false;
    if (session.doIt && session.mode !== "do") {
      pending.current = { q, ids, local };
      session.setMode("do");
      return true;
    }
    void session.ask(q, reply, ids, local);
    sent.current?.();
    return true;
  };
  return { session, submit };
}
