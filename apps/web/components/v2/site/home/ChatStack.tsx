"use client";

import * as React from "react";

import { PpBubble, PpDay } from "@/components/v2/PhonePreview";

import { AI_LABEL, type StackChat } from "./chat-types";
import { DarkPhone } from "./DarkPhone";
import { useStack } from "./StackState";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The home page's phone demo: a real dark phone (our own drawing, DarkPhone) showing ONE conversation of a made-up business at a time, in a box of a fixed size. The shared clock (StackState) says where it is: the CALL first (a dark
 * screen: the avatar with its ring, the business name, the timer and the city, a small voice wave, "Live captions", ONE caption at a time (the assistant's with its "AI assistant" label on the left, the customer's on the right), the round
 * buttons and the red end button), then "Call ended" (the timer stops), then the WhatsApp that follows up (the same business, the same facts) in its own dark mode, stacking bubble by bubble, holds, fades, and the next language starts. The
 * call and the chat are two phones in the SAME box (they cross-fade, nothing moves). The words come from the server; `captions` say in the page's language what each conversation is. Transform and opacity only; the wave pauses while the
 * demo is off screen. With "reduce motion" (and before the script runs) it is ONE still state: the chat, whole, and the style sheet shows the call (its last caption) beside it (stacked on a narrow screen).
 */
export function ChatStack({ chats, captions, sub, placeholder, icons }: { chats: readonly StackChat[]; captions: string[]; sub: string; placeholder: string; /** The icons are drawn on the server (no icon code in the page's script): the call's round buttons, the chat header's icons, the input's mic. */ icons: { callButtons: React.ReactNode; headIcons: React.ReactNode; mic: React.ReactNode } }) {
  const { idx, phase, n, visible, setVisible } = useStack();
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // no way to tell: run (the clock only starts once the phone is "seen")
      const id = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(id);
    }
    const io = new IntersectionObserver((es) => setVisible(es.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [setVisible]);
  const chat = chats[idx];
  return (
    <div ref={root} className="h3-stack" data-phase={phase} data-out={phase === "out" ? "" : undefined} data-paused={!visible || phase !== "call" ? "" : undefined} data-part="chat-stack" data-lang={chat.code}>
      {/* only the CURRENT conversation's two screens are in the page (the call and its WhatsApp, in one grid cell: they cross-fade); the phone has a fixed shape, so nothing moves when the language changes, and the page carries a quarter of the nodes it did with all four */}
      <div className="h3-duo">
        {[chat].map((c) => {
          const i = idx;
          const cur = i === idx;
          const callShown = cur && phase === "call" ? n : c.call.lines.length;
          const line = c.call.lines[Math.max(0, callShown - 1)];
          const callOn = cur && (phase === "call" || phase === "ended");
          const chatOn = cur && (phase === "chat" || phase === "out");
          return (
            <React.Fragment key={c.code}>
              <div className="h3-duo-call" data-part="stack-call" data-shown={callShown} data-on={callOn ? "" : undefined} data-cur={cur ? "" : undefined} aria-hidden={cur ? undefined : true} inert={!cur}>
                <DarkPhone part="dark-phone">
                  <div className="h3-dp-call">
                    <span className="h3-dp-av" aria-hidden="true">
                      {[...c.name][0]}
                    </span>
                    <p className="h3-dp-name">{c.name}</p>
                    <p className="h3-dp-sub">
                      {pad(0)}:{pad(callShown * 7)} · {c.place}
                    </p>
                    <div className="h3-dp-wave" aria-hidden="true">
                      {[0, 1, 2, 3, 4, 5, 6].map((k) => (
                        <i key={k} />
                      ))}
                    </div>
                    <p className="h3-dp-live">{cur && phase === "call" ? c.call.live : c.call.ended}</p>
                    <div className="h3-dp-capbox">
                      {line ? (
                        <p key={`${i}-${callShown}`} className="h3-dp-cap" data-from={line.from} lang={c.code}>
                          <span className="h3-dp-who" lang="en">
                            {line.from === "them" ? AI_LABEL : c.call.you}
                          </span>
                          {line.text}
                        </p>
                      ) : null}
                    </div>
                    <div className="h3-dp-btns" aria-hidden="true">
                      {icons.callButtons}
                    </div>
                  </div>
                </DarkPhone>
              </div>
              <div className="h3-duo-chat" data-part="stack-chat" data-shown={cur && phase === "chat" ? n : c.lines.length} data-on={chatOn ? "" : undefined} data-cur={cur ? "" : undefined} aria-hidden={cur ? undefined : true} inert={!cur}>
                <DarkPhone part="dark-phone">
                  <div className="pp h3-dp-chat" data-pp-theme="dark" data-pp-variant="peek">
                    <div className="pp-head">
                      <span className="h3-dp-back" aria-hidden="true" />
                      <span className="pp-avatar" aria-hidden="true">
                        {[...c.name][0]}
                      </span>
                      <div className="pp-who">
                        <p className="pp-name">{c.name}</p>
                        <p className="pp-sub">{sub}</p>
                      </div>
                      <span className="pp-head-icons">{icons.headIcons}</span>
                    </div>
                    <div className="pp-body">
                      <PpDay>{c.day}</PpDay>
                      {c.lines.map((l, j) => (
                        <PpBubble key={`${i}-${j}`} from={l.from} tail={j === 0 || c.lines[j - 1].from !== l.from} time={l.time} ticks={l.from === "me" ? "read" : undefined}>
                          <span lang={c.code}>{l.text}</span>
                        </PpBubble>
                      ))}
                    </div>
                    <div className="pp-input" aria-hidden="true">
                      <span className="pp-input-box">{placeholder}</span>
                      <span className="pp-mic">{icons.mic}</span>
                    </div>
                  </div>
                </DarkPhone>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <p className="h3-stack-cap" aria-live="polite" data-part="stack-caption">
        {captions[idx]}
      </p>
    </div>
  );
}
