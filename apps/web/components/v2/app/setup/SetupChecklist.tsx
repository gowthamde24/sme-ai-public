"use client";

import { Check, Circle, X } from "lucide-react";

import { say, type TodayWords } from "../today/today-words";
import { card, primary } from "../visits/styles";
import type { Item } from "./setup-logic";

const LABEL = { hours: "setup.check.hours", saree: "setup.check.saree", agent: "setup.check.agent" } as const;

/** The card above Today while setup items are left (job BJ): what is done and what is not, "Continue setup" (opens the wizard at the first thing left) and "Hide" (this device remembers). Gone when all is done. */
export function SetupChecklist({ words, items, onContinue, onOpen, onHide }: { words: TodayWords; items: readonly Item[]; onContinue: () => void; onOpen: (step: number) => void; onHide: () => void }) {
  const done = items.filter((i) => i.done).length;
  return (
    <section aria-labelledby="setup-check-h" data-setup="checklist" className={`${card} gap-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="setup-check-h" className="font-display text-xl font-semibold leading-tight">
            {say(words, "setup.check.title")}
          </h2>
          <p className="text-sm text-muted">{say(words, "setup.check.count", { done, total: items.length })}</p>
        </div>
        <button type="button" onClick={onHide} aria-label={say(words, "setup.check.hide.label")} title={say(words, "setup.check.hide")} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <ul className="flex flex-col">
        {items.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => onOpen(i.step)} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-1 text-left text-base hover:bg-surface-2">
              {i.done ? <Check className="size-5 shrink-0 text-green-text" aria-hidden="true" /> : <Circle className="size-5 shrink-0 text-muted" aria-hidden="true" />}
              <span className={`min-w-0 flex-1 ${i.done ? "text-muted line-through" : "font-medium"}`}>{say(words, LABEL[i.id])}</span>
              <span className="text-sm text-muted">{i.done ? say(words, "setup.check.done") : say(words, "setup.check.todo")}</span>
            </button>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" onClick={onContinue} className={primary}>
          {say(words, "setup.check.continue")}
        </button>
      </div>
    </section>
  );
}
