"use client";

import { useState } from "react";

import { FIELD_LABELS, type Question } from "@/lib/api/enquiries";

/**
 * Clarifying questions, as DRAFT TEXT for a person to copy. They are derived from what is missing or doubtful, from fixed templates:
 * nothing the customer wrote is in them, nothing is stored, and nothing is ever sent from this application.
 */
export function QuestionList({ questions }: { questions: Question[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (questions.length === 0) return <p className="hint">Nothing to ask: every needed field is present.</p>;
  async function copy(q: Question) {
    try {
      await navigator.clipboard.writeText(q.text);
      setCopied(`${q.code}:${q.line_no ?? ""}`);
    } catch {
      setCopied(null); // the text stays selectable on the page
    }
  }
  return (
    <ul className="evidence-list">
      {questions.map((q) => {
        const key = `${q.code}:${q.line_no ?? ""}`;
        return (
          <li key={key} className="evidence-item">
            <p className="hint" style={{ margin: 0 }}>
              {FIELD_LABELS[q.field_key]}
              {q.line_no ? `, line ${q.line_no}` : ""}
            </p>
            <p className="plain-text" style={{ margin: "0.25rem 0 0.5rem" }}>
              {q.text}
            </p>
            <button type="button" className="secondary" onClick={() => copy(q)}>
              {copied === key ? "Copied" : "Copy"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
