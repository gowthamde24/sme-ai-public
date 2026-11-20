"use client";

import * as React from "react";

import type { StackChat } from "./chat-types";
import { afterFirstScroll } from "./first-scroll";

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
type Value = StackState & { visible: boolean; setVisible: (v: boolean) => void; select: (i: number) => void };
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
  const [visible, setVisible] = React.useState(false); // the clock stands still while the phone is off screen (and does not start until it has been seen once: until then the first chat and its filled card are shown whole)
  const holdUntil = React.useRef(0); // after a tap on a language the demo stays on it for 30 s
  const still = React.useRef(false); // reduced motion: no clock at all
  const started = React.useRef(false);
  React.useEffect(() => {
    if (!visible || started.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      started.current = true;
      still.current = true;
      return;
    }
    // the first chat is whole in the server markup (and stays whole in a picture of the page taken at load); once the phone is seen AND the visitor has scrolled, the conversation starts from its call
    return afterFirstScroll(() => {
      started.current = true;
      setSt({ idx: 0, phase: "call", n: 0 });
      setLive(true);
    });
  }, [visible]);
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
      next = { idx: Date.now() < holdUntil.current ? idx : (idx + 1) % chats.length, phase: "call", n: 0 };
    }
    const id = window.setTimeout(() => setSt(next), wait);
    return () => window.clearTimeout(id);
  }, [live, visible, st, chats]);
  // a tap on a language chip: that conversation starts from its call (still: shows its chat whole), and the cycle waits 30 s before it goes on
  const select = React.useCallback(
    (i: number) => {
      holdUntil.current = Date.now() + 30000;
      setSt(still.current ? { idx: i, phase: "chat", n: chats[i].lines.length } : { idx: i, phase: "call", n: 0 });
    },
    [chats],
  );
  const value = React.useMemo(() => ({ ...st, visible, setVisible, select }), [st, visible, select]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * "What it found out": the card beside the phone. It holds the rows of EVERY conversation in one grid cell (so its height is the tallest set's and nothing jumps) and shows the set of the chat that is on the phone; it fades with the chat.
 * The server markup shows the first set (the static first chat's own card).
 */
/** The call caption after which each field of the card is known (1-based: the second line is the customer saying what they want); until then the field says it is listening. */
export const REVEAL_AT = [2, 2, 3] as const;

export function FoundCard({ heading, listening, summary, sets }: { heading: string; listening: string; summary: string; sets: { l: string; v: string }[][] }) {
  const { idx, phase, n } = useStack();
  // each field fills in time with the call's captions (Listening... -> the value with a green tick); once the call has ended every field is known
  const known = (j: number) => phase !== "call" || n >= REVEAL_AT[j];
  return (
    <div className="h3-found" data-part="found-out" data-out={phase === "out" ? "" : undefined} data-set={idx}>
      <p className="h3-found-h">{heading}</p>
      <div className="h3-found-sets">
        {sets.map((rows, i) => (
          <dl key={i} className="h3-found-set" data-set={i} data-on={i === idx ? "" : undefined} aria-hidden={i === idx ? undefined : true}>
            {rows.map((r, j) => {
              const on = i !== idx || known(j);
              return (
                <div key={j} className="h3-found-row" data-known={on ? "" : undefined}>
                  <dt>{r.l}</dt>
                  <dd>
                    {on ? (
                      <>
                        <span className="h3-found-v">{r.v}</span>
                        <span className="h3-found-tick" aria-hidden="true" />
                      </>
                    ) : (
                      <span className="h3-found-wait">{listening}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        ))}
      </div>
      <p className="h3-found-sum">{summary}</p>
    </div>
  );
}

/**
 * The language chips above the phone (sticky): the four languages of the demo, the active one marked; a tap shows that conversation from its call and keeps the demo on it for 30 s (the cycle then goes on). Real buttons, 44 px tall.
 */
export function LangTabs({ chips, codes, label }: { chips: string[]; codes: string[]; label: string }) {
  const { idx, select } = useStack();
  return (
    <div className="h3-tabs" role="group" aria-label={label} data-part="stack-lang">
      {chips.map((c, i) => (
        <button key={codes[i]} type="button" className="h3-tab" lang={codes[i]} aria-pressed={i === idx} onClick={() => select(i)} data-tab={codes[i]}>
          {c}
        </button>
      ))}
    </div>
  );
}
