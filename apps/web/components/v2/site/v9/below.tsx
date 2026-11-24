"use client";

import { useEffect, useRef, useState } from "react";

import { DEMO_LANGS, DEMO_LANG_NAMES, WA, WAVE_HEIGHTS, type DemoLang, type Voice } from "@/lib/site/v9-data";

import { ICON, Phone, TICK, Tabs, reducedMotion } from "./clients";

/** The islands below the first screen (voices, the two jobs, the late call-back picture, the questions): a chunk of their own, loaded with the page's other lazy chunks (./lazy.tsx), so the first visit's JavaScript stays inside the route budget. */
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

// ---------------------------------------------------------------------------------------------- how it works

export type HowWords = { tabs: string; phone: { online: string; message: string; today: string; live: string; ended: string; ai: string }; asked: string; language: string; followUp: string; status: string; added: string };
export function HowDemoClient({ w }: { w: HowWords }) {
  const [lang, setLang] = useState<DemoLang>("te");
  const d = WA[lang];
  return (
    <>
      <Tabs label={w.tabs} items={DEMO_LANGS.map((k) => ({ key: k, text: DEMO_LANG_NAMES[k] }))} value={lang} onChange={setLang} />
      <div className="how8">
        <Phone id="ph-how" still={false} lang={lang} demo={d} words={w.phone} />
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
        <a href="#early-access" className="btn-primary">{w.cta}</a>
      </div>
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
