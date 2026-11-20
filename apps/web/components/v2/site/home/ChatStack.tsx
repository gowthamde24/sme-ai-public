"use client";

import * as React from "react";

import { PhoneCall, PhoneChat, PpBubble, PpDay, PpLine } from "@/components/v2/PhonePreview";

import { AI_LABEL, type StackChat } from "./chat-stack";
import { useStack } from "./StackState";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The home page's phone demo: ONE conversation at a time of a made-up business, in the approved frame, at a fixed size. The shared clock (StackState) says where it is: the CALL first (the assistant's lines on the left labelled "AI assistant",
 * the customer's on the right, appearing one by one, the timer running, "Live captions"), then "Call ended" (the timer stops), then the WhatsApp that follows up stacks in (the same business, the same facts), holds, fades, and the next language
 * starts. The call and the chat are two screens in the SAME box (they cross-fade, nothing moves); a small chip above the phone names the language. The words come from the server; `captions` say in the page's language what each
 * conversation is. Transform and opacity only. With "reduce motion" (and before the script runs) it is ONE still state: the chat, whole, and the style sheet shows the call beside it (stacked on a narrow screen).
 */
export function ChatStack({ chats, chips, captions, sub, placeholder }: { chats: readonly StackChat[]; chips: string[]; captions: string[]; sub: string; placeholder: string }) {
  const { idx, phase, n, setVisible } = useStack();
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => setVisible(es.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [setVisible]);
  const chat = chats[idx];
  const callShown = phase === "call" ? n : chat.call.lines.length;
  const chip = (
    <span className="h3-stack-chip" lang={chat.code} data-part="stack-lang">
      {chips[idx]}
    </span>
  );
  return (
    <div ref={root} className="h3-stack" data-phase={phase} data-out={phase === "out" ? "" : undefined} data-part="chat-stack" data-lang={chat.code}>
      <div className="h3-duo">
        <div className="h3-duo-call" data-part="stack-call">
          {chip}
          <PhoneCall name={chat.name} sub={`${pad(0)}:${pad(callShown * 7)}`} captions={phase === "call" ? chat.call.live : chat.call.ended} theme="auto" keepFrame>
            {chat.call.lines.slice(0, callShown).map((l, i) => (
              <PpLine key={`${idx}-c${i}`} from={l.from} who={l.from === "them" ? AI_LABEL : chat.call.you}>
                <span lang={chat.code}>{l.text}</span>
              </PpLine>
            ))}
          </PhoneCall>
        </div>
        <div className="h3-duo-chat" data-part="stack-chat">
          {chip}
          <PhoneChat name={chat.name} sub={sub} placeholder={placeholder} theme="auto" keepFrame>
            <PpDay>{chat.day}</PpDay>
            {chat.lines.slice(0, phase === "chat" ? n : chat.lines.length).map((l, i) => (
              <PpBubble key={`${idx}-${i}`} from={l.from} tail={i === 0 || chat.lines[i - 1].from !== l.from} time={l.time} ticks={l.from === "me" ? "read" : undefined}>
                <span lang={chat.code}>{l.text}</span>
              </PpBubble>
            ))}
          </PhoneChat>
        </div>
      </div>
      <p className="h3-stack-cap" aria-live="polite" data-part="stack-caption">
        {captions[idx]}
      </p>
    </div>
  );
}
