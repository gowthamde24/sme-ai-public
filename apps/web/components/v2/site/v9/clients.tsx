"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Grip, Mic, Phone as Phone2, PhoneOff, Volume2 } from "lucide-react";

import { PpBubble, PpDay } from "@/components/v2/PhonePreview";
import { DarkPhone } from "@/components/v2/site/home/DarkPhone";
import { DEMO_LANGS, DEMO_LANG_NAMES, WA, WAVE_HEIGHTS, type DemoLang, type Voice } from "@/lib/site/v9-data";

/**
 * The small interactive parts of the home page (landing v9, owner approved 23 Nov 2026). Everything static is a server component (./generated.tsx); only what moves or reacts to a tap is here: the phone
 * (a CSS-looking WhatsApp conversation played with timers once it is on screen), the language tabs, the job draft, the voices rows, the two jobs, the late-call-back picture, the questions and the
 * scroll reveal. The words arrive as props from the server (`./islands.tsx` reads the string store), so no dictionary is shipped to the browser. Reduced motion = the final picture, no timers.
 */
const reducedMotion = (): boolean => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
const TICK = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m20 6-11 11-5-5" />
  </svg>
);

/** Tabs that are real tabs: a tablist, arrow keys move between them, one is selected. */
function Tabs<K extends string>({ label, items, value, onChange, className }: { label: string; items: readonly { key: K; text: string }[]; value: K; onChange: (k: K) => void; className?: string }) {
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
export function Phone({ id, still, lang = "te", words }: { id: string; still: boolean; lang?: DemoLang; words: PhoneWords }) {
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  const [phase, setPhase] = useState<"call" | "chat">("call");
  const [items, setItems] = useState<Item[]>([]);
  const d = WA[lang];

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

// ---------------------------------------------------------------------------------------------- how it works

export type HowWords = { tabs: string; phone: { online: string; message: string; today: string; live: string; ended: string; ai: string }; asked: string; language: string; followUp: string; status: string; added: string };
export function HowDemoClient({ w }: { w: HowWords }) {
  const [lang, setLang] = useState<DemoLang>("te");
  const d = WA[lang];
  return (
    <>
      <Tabs label={w.tabs} items={DEMO_LANGS.map((k) => ({ key: k, text: DEMO_LANG_NAMES[k] }))} value={lang} onChange={setLang} />
      <div className="how8">
        <Phone id="ph-how" still={false} lang={lang} words={w.phone} />
        <div className="how8-right">
          <div className="fcard"><span className="ic">{ICON.search}</span><div><small>{w.asked}</small><strong>{d.asked}</strong></div></div>
          <div className="fcard"><span className="ic">{ICON.globe}</span><div><small>{w.language}</small><strong>{d.lang}</strong></div></div>
          <div className="fcard"><span className="ic">{ICON.chat}</span><div><small>{w.followUp}</small><strong>{d.next}</strong></div></div>
          <div className="fcard"><span className="ic">{ICON.list}</span><div><small>{w.status}</small><strong>{w.added}</strong></div></div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- try it

export type TryPlan = { key: string; chip: string; prompt: string; who: string; say: string; when: string; cost: string };
export type TryWords = { ask: string; draft: string; preview: string; who: string; says: string; when: string; cost: string; cta: string; plans: TryPlan[] };
export function TryItClient({ w }: { w: TryWords }) {
  const [on, setOn] = useState(w.plans[0].key);
  const plan = w.plans.find((p) => p.key === on) ?? w.plans[0];
  const [text, setText] = useState(plan.prompt);
  return (
    <div className="aw-cols">
      <div>
        <label className="aw-lbl" htmlFor="try-input">{w.ask}</label>
        <textarea className="try-input" id="try-input" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="try-chips">
          {w.plans.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={on === p.key}
              className={`try-chip${on === p.key ? " is-on" : ""}`}
              onClick={() => {
                setOn(p.key);
                setText(p.prompt);
              }}
            >
              {p.chip}
            </button>
          ))}
        </div>
      </div>
      <div className="plan-preview aw-draft">
        <div className="plan-preview-head"><span>{w.draft}</span><span>{w.preview}</span></div>
        <div className="plan-row"><span>{w.who}</span><strong>{plan.who}</strong></div>
        <div className="plan-row"><span>{w.says}</span><strong>{plan.say}</strong></div>
        <div className="plan-row"><span>{w.when}</span><strong>{plan.when}</strong></div>
        <div className="plan-row"><span>{w.cost}</span><strong>{plan.cost}</strong></div>
        <a href="#early-access" className="btn-primary" style={{ marginTop: 6 }}>{w.cta}</a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- voices

export type VoiceWords = { tabs: string; soon: string; labels: Record<string, string>; voices: Voice[] };
export function VoicesClient({ w }: { w: VoiceWords }) {
  const [lang, setLang] = useState<DemoLang>("te");
  const L = (s: string) => w.labels[s] ?? s;
  const pill = (v: Voice, i: number, copy: string) => (
    <div className="vpill" key={`${v.who}-${copy}`}>
      <span className={`av${i % 2 ? " g2" : ""}`}>{v.who[0]}</span>
      <div className="txt">
        <h4>{L(v.ind)}</h4>
        <p className="ln" lang={lang}>{v.lines[lang]}</p>
        <div className="tags"><span className="tag">{L(v.group)}</span><span className="who">{v.who} · {L(v.dir)}</span><span className="soon">{w.soon}</span></div>
        <div className="wave" aria-hidden="true">{WAVE_HEIGHTS.map((h, n) => <span key={n} style={{ "--h": `${h}px` } as React.CSSProperties} />)}</div>
      </div>
    </div>
  );
  const rows = [w.voices.slice(0, 4), w.voices.slice(4)];
  return (
    <>
      <Tabs label={w.tabs} items={DEMO_LANGS.map((k) => ({ key: k, text: DEMO_LANG_NAMES[k] }))} value={lang} onChange={setLang} />
      {rows.map((row, r) => (
        <div className={`vmq${r ? " rev" : ""}`} key={r}>
          <div className="vtrack">
            {row.map((v, i) => pill(v, i + r, "a"))}
            <span aria-hidden="true" style={{ display: "contents" }}>{row.map((v, i) => pill(v, i + r, "b"))}</span>
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------- two jobs

export type JobsWords = { tabs: string; jobs: { key: string; tab: string; title: string; checks: string[]; vis: { icon: "phone" | "chat" | "list" | "at" | "clock"; small: string; strong: string }[] }[] };
export function JobsClient({ w }: { w: JobsWords }) {
  const [on, setOn] = useState(w.jobs[0].key);
  const j = w.jobs.find((x) => x.key === on) ?? w.jobs[0];
  return (
    <>
      <Tabs label={w.tabs} items={w.jobs.map((x) => ({ key: x.key, text: x.tab }))} value={on} onChange={setOn} />
      <div className="jobs8">
        <div>
          <h3>{j.title}</h3>
          <ul className="jobs-list">{j.checks.map((c) => <li key={c}>{TICK}{c}</li>)}</ul>
        </div>
        <div className="jobs8-vis">
          {j.vis.map((v) => (
            <div className="fcard" key={v.small}><span className="ic">{ICON[v.icon]}</span><div><small>{v.small}</small><strong>{v.strong}</strong></div></div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- the late call-back picture

export type PipeWords = { tabs: string; fast: string; slow: string; src: string; clock: string; fastTime: string; slowTime: string; bucket: string; lost: string; lostSub: string };
export function PipeClient({ w }: { w: PipeWords }) {
  const [mode, setMode] = useState<"fast" | "slow">("fast");
  const pipe = useRef<HTMLDivElement>(null);
  const bucket = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    const host = pipe.current;
    if (!host || reducedMotion()) return;
    let on = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const spawn = () => {
      if (!on || document.hidden || !host.animate) return;
      const W = host.clientWidth;
      const H = host.clientHeight;
      const x0 = W * (0.36 + Math.random() * 0.28) - 11;
      const cx = W / 2 - 11;
      const keep = modeRef.current === "fast" ? Math.random() < 0.94 : Math.random() < 0.34;
      const wa = Math.random() < 0.5;
      const dropEl = document.createElement("span");
      dropEl.className = `drop ${wa ? "wa" : "ph"}${keep ? "" : " lost"}`;
      dropEl.setAttribute("aria-hidden", "true");
      dropEl.innerHTML = `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${wa ? '<path d="M4 5h16v11H9l-5 4z"/>' : '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>'}</svg>`;
      host.appendChild(dropEl);
      const kf: Keyframe[] = keep
        ? [{ transform: `translate(${x0}px,44px)`, opacity: 0 }, { transform: `translate(${x0}px,70px)`, opacity: 1, offset: 0.1 }, { transform: `translate(${cx}px,200px)`, opacity: 1, offset: 0.5 }, { transform: `translate(${cx}px,${H - 120}px)`, opacity: 1, offset: 0.9 }, { transform: `translate(${cx}px,${H - 100}px)`, opacity: 0 }]
        : [{ transform: `translate(${x0}px,44px)`, opacity: 0 }, { transform: `translate(${x0}px,70px)`, opacity: 1, offset: 0.1 }, { transform: `translate(${cx + 40}px,175px)`, opacity: 1, offset: 0.38 }, { transform: `translate(${W - 90}px,${H - 140}px)`, opacity: 1, offset: 0.9 }, { transform: `translate(${W - 90}px,${H - 120}px)`, opacity: 0 }];
      const a = dropEl.animate(kf, { duration: 2300, easing: "ease-in" });
      a.onfinish = () => {
        dropEl.remove();
        const bk = bucket.current;
        if (keep && bk) {
          bk.classList.remove("bump");
          void bk.offsetWidth;
          bk.classList.add("bump");
        }
      };
    };
    const io = new IntersectionObserver(
      (ents) =>
        ents.forEach((e) => {
          on = e.isIntersecting;
          if (on && !timer) timer = setInterval(spawn, 430);
        }),
      { threshold: 0.15 },
    );
    io.observe(host);
    return () => {
      io.disconnect();
      if (timer) clearInterval(timer);
      host.querySelectorAll(".drop").forEach((n) => n.remove());
    };
  }, []);
  const fast = mode === "fast";
  return (
    <>
      <Tabs className="pipe-tabs" label={w.tabs} items={[{ key: "fast" as const, text: w.fast }, { key: "slow" as const, text: w.slow }]} value={mode} onChange={setMode} />
      <div className="pipe" ref={pipe}>
        <div className="src"><span className="src-dot" />{w.src}</div>
        <div className={`pclock${fast ? "" : " slow"}`}><small>{w.clock}</small><b>{fast ? w.fastTime : w.slowTime}</b></div>
        <div className="funnel" /><div className="neck" />
        <div className="bucket" ref={bucket}><div className="fill" style={{ height: fast ? "90%" : "32%" }} /><b>{w.bucket}</b></div>
        <div className="tray"><span>{w.lost}</span><small>{w.lostSub}</small></div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- questions

export function FaqClient({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="faq-list">
      {items.map((it, i) => {
        const on = open === i;
        return (
          <div className={`faq-item${on ? " is-open" : ""}`} key={it.q}>
            <button type="button" className="faq-q" aria-expanded={on} aria-controls={`faq-a-${i}`} id={`faq-q-${i}`} onClick={() => setOpen(on ? -1 : i)}>
              {it.q}
              <span aria-hidden="true">{on ? "−" : "+"}</span>
            </button>
            <div className="faq-a" id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`}>{it.a}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- scroll reveal

/** Sections below the fold fade in once. Nothing is hidden before this runs and nothing is hidden when motion is reduced. */
export function Reveal() {
  useEffect(() => {
    const root = document.querySelector(".v9");
    if (!root || reducedMotion() || !("IntersectionObserver" in window)) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]")).filter((e) => e.getBoundingClientRect().top > window.innerHeight);
    els.forEach((e) => e.classList.add("rv-wait"));
    const io = new IntersectionObserver(
      (ents) => {
        for (const e of ents)
          if (e.isIntersecting) {
            e.target.classList.add("is-shown");
            e.target.classList.remove("rv-wait");
            io.unobserve(e.target);
          }
      },
      { threshold: 0.06 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return null;
}
