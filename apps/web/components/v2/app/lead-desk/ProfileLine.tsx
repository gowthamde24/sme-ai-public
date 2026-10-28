import type { DeskLead } from "@/lib/lead-desk/leads";
import type { Field } from "@/lib/lead-desk/profile";

import { pillAmber, pillNeutral } from "../ui";

/** What the lead is, in one line (need, size, place, budget, when), and how urgent. A guessed part carries a small marker ("?") and says so; the words the customer wrote stay one tap away ("As they wrote it"). */
export function ProfileLine({ p, words }: { p: NonNullable<DeskLead["profile"]>; words: Record<string, string> }) {
  const part = (field: Field, value: string | null) =>
    value ? (
      <span key={field}>
        {value}
        {p.guessed.includes(field) ? <span title={words["lp.guess"]} aria-label={words["lp.guess"]} className="ml-0.5 font-semibold text-amber-text">?</span> : null}
      </span>
    ) : null;
  const parts = [part("need", p.need), part("quantity", p.quantity), part("area", p.area ?? p.city), part("budget", p.budget), part("timeline", p.timeline)].filter(Boolean);
  return (
    <div className="mt-1 flex flex-col gap-1">
      {parts.length > 0 || p.urgency ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-ink">
          {parts.map((x, i) => (
            <span key={i} className="after:ml-2 after:text-muted last:after:hidden after:content-['·']">
              {x}
            </span>
          ))}
          {p.urgency ? <span className={p.urgency === "high" ? pillAmber : pillNeutral}>{words[`lp.urgency.${p.urgency}`]}{p.guessed.includes("urgency") ? " ?" : ""}</span> : null}
        </p>
      ) : null}
      {p.mergedCount > 0 ? <p className="text-sm text-muted">{(words["lp.dup"] ?? "").replace("{n}", String(p.mergedCount + 1))}</p> : null}
      {p.originalText ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{words["lp.original"]}</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-ink">{p.originalText}</p>
        </details>
      ) : null}
    </div>
  );
}

