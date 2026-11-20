"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useOnViewOnce } from "./use-on-view-once";

/** One of the example jobs: the words of its plan card, already in the visitor's language (static; nothing is asked of an AI). */
export type AskJob = { chip: string; who: string; says: string; when: string; keys: string[] };

const TYPE_MS = 1200; // the example is typed in about this long, at a steady pace
const ROW_MS = 380; // then the plan card's four lines come in one by one

/**
 * "Tell it what to do" (home page, section 3): a box to type in (the owner's own words), ONE row of example chips (swipe), and the PLAN CARD of the job: Who it is for, what it says, when, what it costs, from the static words of the
 * five example jobs. A live moment, played once when the block scrolls into view: the first example is TYPED into the box (about 1.2 s) and the card's four lines appear one by one; tapping a chip replays it for that chip (reduced
 * motion and no script: the final state at once, as the server draws it: the first example in the box and the card whole). It calls NO AI and sends NOTHING; the cost line is the same for every job (it names no price). "Set this up" leads to early access. The words come from the server (in the visitor's language).
 */
export function AskBox({ words, jobs, href }: { words: { label: string; placeholder: string; go: string; who: string; says: string; when: string; cost: string; costValue: string; plan: string }; jobs: AskJob[]; href: string }) {
  // the server draws the FINAL state (the first example typed, its card whole); a browser that can play the moment starts it from empty
  const [text, setText] = useState(jobs[0].chip);
  const [picked, setPicked] = useState<number | null>(0);
  const [rows, setRows] = useState(4); // how many of the card's four lines are in
  const id = useId();
  const [box, phase] = useOnViewOnce<HTMLDivElement>();
  const timers = useRef<number[]>([]);
  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  // type the chip's words in (steady), then bring the four lines in one by one
  const play = useCallback(
    (i: number, still: boolean) => {
      stop();
      const full = jobs[i].chip;
      if (still) {
        later(() => {
          setText(full);
          setPicked(i);
          setRows(4);
        }, 0);
        return;
      }
      const chars = [...full];
      const step = TYPE_MS / chars.length;
      later(() => {
        setPicked(null);
        setRows(0);
        setText("");
      }, 0);
      chars.forEach((_, n) => later(() => setText(chars.slice(0, n + 1).join("")), step * (n + 1)));
      later(() => setPicked(i), TYPE_MS + 120);
      for (let r = 1; r <= 4; r++) later(() => setRows(r), TYPE_MS + 120 + ROW_MS * r);
    },
    [jobs, later, stop],
  );
  const started = useRef(false);
  // "ready": the block waits below the fold, empty (the start state); "played": it was seen once, the example is typed in; "final": reduced motion or no script: it stays whole
  useEffect(() => {
    if (started.current) return;
    if (phase === "ready") {
      const id = window.setTimeout(() => {
        setText("");
        setPicked(null);
        setRows(0);
      }, 0);
      return () => window.clearTimeout(id);
    }
    if (phase === "played") {
      started.current = true;
      play(0, false);
    }
  }, [phase, play]);
  useEffect(() => stop, [stop]);
  const fromText = (v: string) => {
    const q = v.toLowerCase();
    const i = jobs.findIndex((j) => j.keys.some((x) => q.includes(x)));
    return i < 0 ? null : i;
  };
  const job = picked === null ? null : jobs[picked];
  const rowsData = job ? [[words.who, job.who], [words.says, job.says], [words.when, job.when], [words.cost, words.costValue]] : [];
  return (
    <div className="h3-ask" data-part="ask-box" ref={box}>
      <label htmlFor={id} className="sr-only">
        {words.label}
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => {
          stop();
          started.current = true;
          setText(e.target.value);
          const p = fromText(e.target.value);
          setPicked(p);
          setRows(p === null ? 0 : 4);
        }}
        placeholder={words.placeholder}
        rows={2}
        maxLength={400}
        className="h3-ask-input"
      />
      <ul className="h3-chips" aria-label={words.label}>
        {jobs.map((j, i) => (
          <li key={i}>
            <button
              type="button"
              className="h3-chip"
              aria-pressed={picked === i}
              onClick={() => {
                started.current = true;
                play(i, typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true);
              }}
              data-chip={i + 1}
            >
              {j.chip}
            </button>
          </li>
        ))}
      </ul>
      <div className="h3-plan" data-part="plan-card" data-on={job ? "" : undefined} aria-live="polite">
        {job ? (
          <dl className="h3-plan-card">
            {rowsData.map(([dt, dd], n) => (
              <div key={n} className="h3-plan-row" data-in={n < rows ? "" : undefined}>
                <dt>{dt}</dt>
                <dd>{dd}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <Link href={href} className="h3-btn h3-btn-main h3-btn-block" data-part="ask-go">
        {words.go}
        <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
      </Link>
    </div>
  );
}
