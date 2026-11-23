"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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

const tm = (n: number) => `10:${String(4 + n).padStart(2, "0")}`;
const END_CALL = "M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z";

export function Phone({ id, width, still, lang = "te", words }: { id: string; width: number; still: boolean; lang?: DemoLang; words: { online: string; message: string; today: string } }) {
  const root = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const call = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  const d = WA[lang];

  useEffect(() => {
    const chatEl = chat.current;
    const callEl = call.current;
    if (!chatEl || !callEl || still) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const stop = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };
    const add = (el: HTMLElement) => {
      chatEl.appendChild(el);
      while (chatEl.children.length > 7) chatEl.removeChild(chatEl.firstChild as ChildNode);
    };
    const el = (tag: string, cls: string) => {
      const n = document.createElement(tag);
      n.className = cls;
      return n;
    };
    const bubble = (kind: string, text: string, i: number) => {
      const b = el("div", `wa-b ${kind}`);
      b.textContent = text;
      const s = el("span", "t");
      s.textContent = tm(i);
      b.appendChild(s);
      add(b);
    };
    const file = (name: string, meta: string) => {
      const f = el("div", "wa-file");
      const i = el("i", "");
      i.textContent = "PDF";
      const box = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = name;
      const s = document.createElement("span");
      s.textContent = meta;
      box.append(b, s);
      f.append(i, box);
      add(f);
    };
    const typing = () => {
      const t = el("div", "wa-typing");
      t.innerHTML = "<span></span><span></span><span></span>";
      add(t);
      return t;
    };
    const day = () => {
      const x = el("div", "wa-day");
      x.textContent = words.today;
      add(x);
    };
    const final = () => {
      chatEl.innerHTML = "";
      day();
      d.steps.forEach((s, i) => (s.length === 3 ? file(s[1], s[2]) : bubble(s[0], s[1], i)));
      callEl.classList.add("is-off");
    };
    const play = () => {
      stop();
      chatEl.innerHTML = "";
      if (reducedMotion()) return final();
      callEl.classList.remove("is-off");
      let t = 3800;
      at(t, () => {
        callEl.classList.add("is-off");
        day();
      });
      d.steps.forEach((s, i) => {
        if (s.length === 2 && s[0] === "in") {
          t += 900;
          const line = s[1];
          at(t, () => bubble("in", line, i));
        } else if (s.length === 2) {
          t += 700;
          let ty: HTMLElement | null = null;
          at(t, () => {
            ty = typing();
          });
          t += 1400;
          at(t, () => {
            ty?.remove();
            bubble("out", s[1], i);
          });
        } else if (s.length === 3) {
          t += 900;
          const [, name, meta] = s;
          at(t, () => file(name, meta));
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
  return (
    <div ref={root} className={`s26${still ? " static" : ""}`} id={id} style={{ "--pw": `${width}px` } as React.CSSProperties} aria-hidden="true">
      <i className="k k-vol" />
      <i className="k k-pwr" />
      <div className="s26-body">
        <div className="s26-screen">
          <span className="s26-cam" />
          <div className="s26-status">
            <span>9:41</span>
            <span>
              <svg width="46" height="14" viewBox="0 0 46 14" fill="#e9edef">
                <path d="M1 11h3v2H1zM6 8h3v5H6zM11 5h3v8h-3zM16 2h3v11h-3z" />
                <rect x="26" y="2" width="18" height="10" rx="3" fill="none" stroke="#e9edef" strokeWidth="1.6" />
                <rect x="28" y="4" width="11" height="6" rx="1.5" />
              </svg>
            </span>
          </div>
          <div className="wa-head">
            <span className="wa-back">‹</span>
            <span className="wa-av">{initial}</span>
            <div className="wa-name">
              <strong>{d.biz}</strong>
              <span>{words.online}</span>
            </div>
            <span className="wa-ico">
              <span>⌕</span>
              <span>⋮</span>
            </span>
          </div>
          <div className="wa-chat" ref={chat} />
          <div className="wa-input">
            <div className="box">{words.message}</div>
            <span className="mic">●</span>
          </div>
          <div className="s26-call" ref={call}>
            <div className="ring">
              <b>{initial}</b>
            </div>
            <h4>{d.biz}</h4>
            <p>{d.label}</p>
            <div className="wv">
              {Array.from({ length: 13 }, (_, i) => (
                <span key={i} />
              ))}
            </div>
            <div className="cap">{d.cap}</div>
            <span className="end">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff">
                <path d={END_CALL} />
              </svg>
            </span>
          </div>
        </div>
      </div>
      <span className="s26-slot" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- how it works

export type HowWords = { tabs: string; phone: { online: string; message: string; today: string }; asked: string; language: string; followUp: string; status: string; added: string };
export function HowDemoClient({ w }: { w: HowWords }) {
  const [lang, setLang] = useState<DemoLang>("te");
  const d = WA[lang];
  return (
    <>
      <Tabs label={w.tabs} items={DEMO_LANGS.map((k) => ({ key: k, text: DEMO_LANG_NAMES[k] }))} value={lang} onChange={setLang} />
      <div className="how8">
        <Phone id="ph-how" width={270} still={false} lang={lang} words={w.phone} />
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
