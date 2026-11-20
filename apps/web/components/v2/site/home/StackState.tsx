"use client";

import * as React from "react";

import type { StackChat } from "./chat-stack";

// the pace of one conversation (about 13 s in all): the call's captions one by one, the call ends, the WhatsApp stacks in, it holds, it fades, the next language starts
const CALL_FIRST = 600;
const CALL_STEP = 1200;
const CALL_END = 900; // the last caption is on; then "Call ended"
const ENDED = 1000; // "Call ended" stays, then the chat takes the screen
const CHAT_FIRST = 500;
const CHAT_STEP = 900;
const HOLD = 2600; // the whole chat and its card stay
const FADE = 600;

export type Phase = "call" | "ended" | "chat" | "out";
type StackState = { idx: number; phase: Phase; n: number };
type Value = StackState & { setVisible: (v: boolean) => void };
const Ctx = React.createContext<Value | null>(null);
export const useStack = (): Value => {
  const s = React.useContext(Ctx);
  if (!s) throw new Error("useStack needs a StackProvider");
  return s;
};

/**
 * The ONE clock of the home page's phone demo (the phone with its call and its chat, the language chip and caption, and the "What it found out" card all read it, so they change together and cannot drift): which conversation is on, which phase
 * (the call's captions one by one, the call ended, the WhatsApp bubbles stacking in, fading out) and how many lines of that phase are in. With "reduce motion" (and before the script runs) it is ONE still state: the first conversation's chat,
 * whole, with its card (the call is shown beside it by the style sheet).
 */
export function StackProvider({ chats, children }: { chats: readonly StackChat[]; children: React.ReactNode }) {
  const [st, setSt] = React.useState<StackState>({ idx: 0, phase: "chat", n: chats[0].lines.length });
  const [live, setLive] = React.useState(false);
  const [visible, setVisible] = React.useState(true); // the clock stands still while the phone is off screen
  React.useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // the first chat is whole in the server markup; once the script runs, the conversation starts from its call
    const id = window.setTimeout(() => {
      setSt({ idx: 0, phase: "call", n: 0 });
      setLive(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  React.useEffect(() => {
    if (!live || !visible) return;
    const { idx, phase, n } = st;
    const calls = chats[idx].call.lines.length;
    const lines = chats[idx].lines.length;
    let wait: number;
    let next: StackState;
    if (phase === "call") {
      wait = n === 0 ? CALL_FIRST : n < calls ? CALL_STEP : CALL_END;
      next = n < calls ? { idx, phase, n: n + 1 } : { idx, phase: "ended", n };
    } else if (phase === "ended") {
      wait = ENDED;
      next = { idx, phase: "chat", n: 0 };
    } else if (phase === "chat") {
      wait = n === 0 ? CHAT_FIRST : n < lines ? CHAT_STEP : HOLD;
      next = n < lines ? { idx, phase, n: n + 1 } : { idx, phase: "out", n };
    } else {
      wait = FADE;
      next = { idx: (idx + 1) % chats.length, phase: "call", n: 0 };
    }
    const id = window.setTimeout(() => setSt(next), wait);
    return () => window.clearTimeout(id);
  }, [live, visible, st, chats]);
  const value = React.useMemo(() => ({ ...st, setVisible }), [st]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * "What it found out": the card beside the phone. It holds the rows of EVERY conversation in one grid cell (so its height is the tallest set's and nothing jumps) and shows the set of the chat that is on the phone; it fades with the chat.
 * The server markup shows the first set (the static first chat's own card).
 */
export function FoundCard({ heading, sets }: { heading: string; sets: { l: string; v: string }[][] }) {
  const { idx, phase, n } = useStack();
  // the card fills for the conversation on the phone as the WhatsApp stacks in (one row for each bubble that has come), and fades with it
  const rowOn = (j: number) => phase === "out" || (phase === "chat" && n > j);
  return (
    <div className="h3-found" data-part="found-out" data-out={phase === "out" ? "" : undefined} data-set={idx}>
      <p className="h3-found-h">{heading}</p>
      <div className="h3-found-sets">
        {sets.map((rows, i) => (
          <dl key={i} className="h3-found-set" data-set={i} data-on={i === idx ? "" : undefined} aria-hidden={i === idx ? undefined : true}>
            {rows.map((r, j) => (
              <div key={j} className="h3-found-row" data-row={i === idx && rowOn(j) ? "" : undefined}>
                <dt>{r.l}</dt>
                <dd>{r.v}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </div>
  );
}
