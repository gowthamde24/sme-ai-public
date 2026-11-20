"use client";

import * as React from "react";

import { PhoneChat, PpBubble, PpDay } from "@/components/v2/PhonePreview";

import type { StackChat } from "./chat-stack";

const STEP = 1100; // one bubble every 1.1 s
const HOLD = 3000; // the whole chat stays for about 3 s
const FADE = 600; // then it fades out, and the next language starts

/**
 * The home page's chat stack: one phone (the approved frame, at a fixed size, so nothing moves when the language changes) that cycles through the conversations in turn: the bubbles rise in one by one and stack, the chat holds for about 3 s,
 * fades out, and the next language starts. A small chip at the top of the screen names the language. The words come from the server (`chats`, already in each conversation's own language); `captions` say in the page's language what
 * each conversation is. Transform and opacity only. With "reduce motion" (and before the script runs) it is ONE still chat: the first, whole.
 */
export function ChatStack({ chats, chips, captions, sub, placeholder }: { chats: StackChat[]; chips: string[]; captions: string[]; sub: string; placeholder: string }) {
  const [idx, setIdx] = React.useState(0);
  const [shown, setShown] = React.useState(chats[0].lines.length);
  const [out, setOut] = React.useState(false);
  const [live, setLive] = React.useState(false);
  React.useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // the first chat is whole in the server markup; once the script runs, it starts again from the first bubble
    const id = window.setTimeout(() => {
      setShown(0);
      setLive(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  React.useEffect(() => {
    if (!live) return;
    const n = chats[idx].lines.length;
    let wait: number;
    let next: () => void;
    if (out) {
      wait = FADE;
      next = () => {
        setIdx((i) => (i + 1) % chats.length);
        setShown(0);
        setOut(false);
      };
    } else if (shown < n) {
      wait = shown === 0 ? 500 : STEP;
      next = () => setShown((s) => s + 1);
    } else {
      wait = HOLD;
      next = () => setOut(true);
    }
    const id = window.setTimeout(next, wait);
    return () => window.clearTimeout(id);
  }, [live, idx, shown, out, chats]);
  const chat = chats[idx];
  return (
    <div className="h3-stack" data-out={out ? "" : undefined} data-part="chat-stack" data-lang={chat.code}>
      <PhoneChat name={chat.name} sub={sub} placeholder={placeholder} theme="auto" keepFrame>
        <span className="h3-stack-chip" lang={chat.code} data-part="stack-lang">
          {chips[idx]}
        </span>
        <PpDay>{chat.day}</PpDay>
        {chat.lines.slice(0, shown).map((l, i) => (
          <PpBubble key={`${idx}-${i}`} from={l.from} tail={i === 0 || chat.lines[i - 1].from !== l.from} time={l.time} ticks={l.from === "me" ? "read" : undefined}>
            <span lang={chat.code}>{l.text}</span>
          </PpBubble>
        ))}
      </PhoneChat>
      <p className="h3-stack-cap" aria-live="polite" data-part="stack-caption">
        {captions[idx]}
      </p>
    </div>
  );
}
