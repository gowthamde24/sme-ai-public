"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

/** One of the example jobs: the words of its plan card, already in the visitor's language (static; nothing is asked of an AI). */
export type AskJob = { chip: string; who: string; says: string; when: string; keys: string[] };

/**
 * "Tell it what to do" (home page, section 3): a box to type in (the owner's own words), ONE row of example chips (swipe), and the PLAN CARD of the job: Who it is for, what it says, when, what it costs, shown in the page from
 * the static words of the five example jobs. It calls NO AI and sends NOTHING: a chip (or a keyword typed in the box) only picks which of the five sample cards to show; the cost line is the same for every job (it names no
 * price). "Set this up" leads to early access. The words come from the server (already in the visitor's language).
 */
export function AskBox({ words, jobs, href }: { words: { label: string; placeholder: string; go: string; who: string; says: string; when: string; cost: string; costValue: string; plan: string }; jobs: AskJob[]; href: string }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const id = useId();
  const fromText = (v: string) => {
    const s = v.toLowerCase();
    const i = jobs.findIndex((j) => j.keys.some((x) => s.includes(x)));
    return i < 0 ? null : i;
  };
  const job = picked === null ? null : jobs[picked];
  return (
    <div className="h3-ask" data-part="ask-box">
      <label htmlFor={id} className="sr-only">
        {words.label}
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPicked(fromText(e.target.value));
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
                setText(j.chip);
                setPicked(i);
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
            <div>
              <dt>{words.who}</dt>
              <dd>{job.who}</dd>
            </div>
            <div>
              <dt>{words.says}</dt>
              <dd>{job.says}</dd>
            </div>
            <div>
              <dt>{words.when}</dt>
              <dd>{job.when}</dd>
            </div>
            <div>
              <dt>{words.cost}</dt>
              <dd>{words.costValue}</dd>
            </div>
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
