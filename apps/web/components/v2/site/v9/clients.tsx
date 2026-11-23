"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Grip, Mic, Phone as Phone2, PhoneOff, Volume2 } from "lucide-react";

import { PpBubble, PpDay } from "@/components/v2/PhonePreview";
import { DarkPhone } from "@/components/v2/site/home/DarkPhone";
import type { Demo, DemoLang } from "@/lib/site/v9-data";

/**
 * The small interactive parts of the home page (landing v9, owner approved 23 Nov 2026). Everything static is a server component (./generated.tsx); only what moves or reacts to a tap is here: the phone
 * (a CSS-looking WhatsApp conversation played with timers once it is on screen), the language tabs, the job draft, the voices rows, the two jobs, the late-call-back picture, the questions and the
 * scroll reveal. The words arrive as props from the server (`./islands.tsx` reads the string store), so no dictionary is shipped to the browser. Reduced motion = the final picture, no timers.
 */
export const reducedMotion = (): boolean => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const I = ({ children }: { children: ReactNode }) => (
  <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const ICON = {
  phone: <I><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></I>,
  chat: <I><path d="M4 5h16v11H9l-5 4z" /></I>,
  list: <I><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></I>,
  at: <I><circle cx="12" cy="12" r="4" /><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7" /></I>,
  clock: <I><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>,
  search: <I><circle cx="11" cy="11" r="7" /><path d="m21 21-4.5-4.5" /></I>,
  globe: <I><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></I>,
};
export const TICK = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m20 6-11 11-5-5" />
  </svg>
);

/** Tabs that are real tabs: a tablist, arrow keys move between them, one is selected. */
export function Tabs<K extends string>({ label, items, value, onChange, className }: { label: string; items: readonly { key: K; text: string }[]; value: K; onChange: (k: K) => void; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number, d: number) => {
    const n = (i + d + items.length) % items.length;
    onChange(items[n].key);
    refs.current[n]?.focus();
  };
  return (
    <div className={`tabs${className ? ` ${className}` : ""}`} role="tablist" aria-label={label}>
      {items.map((it, i) => (
        <button
          key={it.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={value === it.key}
          tabIndex={value === it.key ? 0 : -1}
          className={`tab-btn${value === it.key ? " is-on" : ""}`}
          onClick={() => onChange(it.key)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); move(i, 1); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); move(i, -1); }
          }}
        >
          {it.text}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- the phone

type Item = { key: number; kind: "day" | "in" | "out" | "file" | "typing"; text: string; meta?: string; time?: string };
type PhoneWords = { online: string; message: string; today: string; live: string; ended: string; ai: string };
const tm = (n: number) => `10:${String(4 + n).padStart(2, "0")}`;

/**
 * The phone the owner likes (23 Nov 2026): the site's own dark phone (DarkPhone: near-black flat screen, dynamic-island pill, status bar, thin bezel, side keys on the right, home bar), the same call screen as the
 * old home page (design/home3.css, `.h3-dp-*`) and the same WhatsApp chat (`PpBubble`, design/phone-preview.css). The call is a layer over the chat; after about four seconds it ends and the chat plays: the
 * customer's line, a typing pause, the assistant's reply, the brochure. Timers start once the phone is on screen; reduced motion shows the finished chat. `still` = the call screen only (the picture in "While it talks").
 */
export function Phone({ id, still, lang, demo: d, words }: { id: string; still: boolean; lang: DemoLang; /** The conversation to play (the server passes it, so the four of them are not in this chunk). */ demo: Demo; words: PhoneWords }) {
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  const [phase, setPhase] = useState<"call" | "chat">("call");
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    if (still) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    let n = 0;
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const stop = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };
    const push = (it: Omit<Item, "key">) => setItems((cur): Item[] => [...cur.filter((x) => x.kind !== "typing"), { ...it, key: ++n }].slice(-6));
    const final = () => {
      setPhase("chat");
      setItems([{ key: 0, kind: "day" as const, text: words.today }, ...d.steps.map((st, i): Item => (st.length === 3 ? { key: i + 1, kind: "file", text: st[1], meta: st[2] } : { key: i + 1, kind: st[0], text: st[1], time: tm(i) }))].slice(-6));
    };
    const play = () => {
      stop();
      n = 0;
      setItems([]);
      if (reducedMotion()) return final();
      setPhase("call");
      let t = 3800;
      at(t, () => {
        setPhase("chat");
        push({ kind: "day", text: words.today });
      });
      d.steps.forEach((st, i) => {
        if (st.length === 3) {
          t += 900;
          const [, name, meta] = st;
          at(t, () => push({ kind: "file", text: name, meta }));
        } else if (st[0] === "in") {
          t += 900;
          const line = st[1];
          at(t, () => push({ kind: "in", text: line, time: tm(i) }));
        } else {
          t += 700;
          at(t, () => setItems((cur): Item[] => [...cur, { key: ++n, kind: "typing" as const, text: "" }].slice(-6)));
          t += 1400;
          const line = st[1];
          at(t, () => push({ kind: "out", text: line, time: tm(i) }));
        }
      });
      t += 4200;
      at(t, play);
    };
    // start when the phone is on screen (and again from the start when the language changes)
    let io: IntersectionObserver | null = null;
    if (seen.current || !("IntersectionObserver" in window)) play();
    else {
      io = new IntersectionObserver(
        (ents) => {
          if (ents.some((e) => e.isIntersecting)) {
            seen.current = true;
            io?.disconnect();
            play();
          }
        },
        { threshold: 0.2 },
      );
      if (root.current) io.observe(root.current);
    }
    return () => {
      stop();
      io?.disconnect();
    };
  }, [d, still, words.today]);

  const initial = d.biz[0];
  const shownPhase = still ? "call" : phase;
  return (
    <div ref={root} className="v9-phone" id={id} aria-hidden="true">
      <DarkPhone part="dark-phone">
        <div className="pp h3-dp-chat" data-pp-theme="dark" data-pp-variant="peek">
          <div className="pp-head">
            <span className="h3-dp-back" aria-hidden="true" />
            <span className="pp-avatar" aria-hidden="true">{initial}</span>
            <div className="pp-who">
              <p className="pp-name">{d.biz}</p>
              <p className="pp-sub">{words.online}</p>
            </div>
            <span className="pp-head-icons">
              <Phone2 aria-hidden="true" size={20} strokeWidth={2} />
              <span className="h3-dp-dots" aria-hidden="true" />
            </span>
          </div>
          <div className="pp-body">
            {items.map((it) =>
              it.kind === "day" ? (
                <PpDay key={it.key}>{it.text}</PpDay>
              ) : it.kind === "typing" ? (
                <PpBubble key={it.key} from="me">
                  <span className="v9-dots"><i /><i /><i /></span>
                </PpBubble>
              ) : it.kind === "file" ? (
                <PpBubble key={it.key} from="me" ticks="read">
                  <span className="v9-file"><i>PDF</i><span><b>{it.text}</b><small>{it.meta}</small></span></span>
                </PpBubble>
              ) : (
                <PpBubble key={it.key} from={it.kind === "in" ? "them" : "me"} tail time={it.time} ticks={it.kind === "out" ? "read" : undefined}>
                  <span lang={lang}>{it.text}</span>
                </PpBubble>
              ),
            )}
          </div>
          <div className="pp-input" aria-hidden="true">
            <span className="pp-input-box">{words.message}</span>
            <span className="pp-mic"><Mic size={20} strokeWidth={2.2} /></span>
          </div>
        </div>
        <div className={`v9-call${shownPhase === "chat" ? " is-off" : ""}`}>
          <div className="h3-dp-call">
            <span className="h3-dp-av" aria-hidden="true">{initial}</span>
            <p className="h3-dp-name">{d.biz}</p>
            <p className="h3-dp-sub">{d.label}</p>
            <div className="h3-dp-wave" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6].map((k) => (
                <i key={k} />
              ))}
            </div>
            <p className="h3-dp-live">{words.live}</p>
            <div className="h3-dp-capbox">
              <p className="h3-dp-cap" data-from="them" lang={lang}>
                <span className="h3-dp-who">{words.ai}</span>
                {d.cap}
              </p>
            </div>
            <div className="h3-dp-btns" aria-hidden="true">
              <span className="h3-dp-btn"><Mic size={20} strokeWidth={2} /></span>
              <span className="h3-dp-btn"><Grip size={20} strokeWidth={2} /></span>
              <span className="h3-dp-btn"><Volume2 size={20} strokeWidth={2} /></span>
              <span className="h3-dp-btn h3-dp-end"><PhoneOff size={22} strokeWidth={2.2} /></span>
            </div>
          </div>
        </div>
      </DarkPhone>
    </div>
  );
}
