"use client";

import * as React from "react";

import type { LocalAnswer } from "../ask/ask-types";
import { useStoredAsk } from "../ask/ask-store";
import { wakeAsk } from "../ask/ask-wake";
import { restoreSettled } from "../ask/use-restore-thread";

/**
 * "Do it" for Today's v6 parts (the command bar, a suggested job, the phone): hands an instruction to the EXISTING plan-card flow of the workspace's shared conversation (plan, then Approve, then it runs, then Undo). The conversation is put into its "do" mode first
 * (where the person may make a plan), then asks; where it has no plan mode, the instruction is asked as a question. Nothing starts by itself: the plan card waits for the owner. `onSent` is called when an instruction has gone in (the input clears). `submit` is false when there is
 * no conversation to ask with (yet).
 * The earlier conversation is only read once the composer or the orb is first used (ask-wake.ts): a first send wakes it, and when that read is still running the instruction waits for it (at most about a second and a half) so it goes on in the same conversation.
 */
export function usePlanSubmit(reply?: string, onSent?: () => void) {
  const session = useStoredAsk();
  const pending = React.useRef<{ q: string; ids?: readonly string[]; local?: LocalAnswer | null } | null>(null);
  const holding = React.useRef(false); // an instruction is waiting for the earlier conversation to arrive: a second press does not send it twice
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
    if (holding.current) return true;
    wakeAsk(); // a first send is a first use (the composer's own focus has normally done it already)
    const go = () => {
      if (session.doIt && session.mode !== "do") {
        pending.current = { q, ids, local };
        session.setMode("do");
        return;
      }
      void session.ask(q, reply, ids, local);
      sent.current?.();
    };
    const waiting = restoreSettled();
    if (waiting === null) go();
    else {
      holding.current = true;
      void waiting.then(() => {
        holding.current = false;
        go();
      });
    }
    return true;
  };
  return { session, submit };
}
