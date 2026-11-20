"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

/**
 * "What should your assistant do?" (home page, section 2): one box to type in (the owner's own words, or an example chip that fills it) and one button that leads to sign-up (the early-access form). It calls NO AI: nothing typed here
 * leaves the browser, the page promises no answer. Typing only (no microphone until speaking exists). The words come from the server (already in the visitor's language).
 */
export function AskBox({ words, chips, href }: { words: { label: string; placeholder: string; go: string }; chips: string[]; href: string }) {
  const [text, setText] = useState("");
  const id = useId();
  return (
    <div className="h3-ask" data-part="ask-box">
      <label htmlFor={id} className="sr-only">
        {words.label}
      </label>
      <div className="h3-ask-field">
        <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder={words.placeholder} rows={3} maxLength={400} className="h3-ask-input" />
        <div className="h3-ask-bar">
          <Link href={href} className="h3-btn h3-btn-main" data-part="ask-go">
            {words.go}
            <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <ul className="h3-chips" aria-label={words.label}>
        {chips.map((c, i) => (
          <li key={i}>
            <button type="button" className="h3-chip" onClick={() => setText(c)} data-chip={i + 1}>
              {c}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
