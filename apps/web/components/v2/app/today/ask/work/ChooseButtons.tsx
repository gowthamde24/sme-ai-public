"use client";

import * as React from "react";

import type { ChooseCard } from "@/lib/assistant-work/types";

import { btnSmall, cardBox, type WorkEnv } from "./work-env";

/**
 * "Which Kalyani?" as buttons, one per option: a tap sends the option as the next message, in the same conversation (it answers the waiting question). Once one is tapped the others are off and the chosen one is marked: a second
 * tap would answer a question that is no longer waiting.
 */
export function ChooseButtons({ card, env }: { card: ChooseCard; env: WorkEnv }) {
  const { t, onSend } = env;
  const [chosen, setChosen] = React.useState<string | null>(null);
  return (
    <article data-work="choose" className={cardBox}>
      <p className="text-base font-semibold">{card.question}</p>
      <div role="group" aria-label={card.question} className="mt-2 flex flex-wrap gap-2">
        {card.options.map((o) => (
          <button
            key={o.value}
            type="button"
            data-choice={o.value}
            aria-pressed={chosen === o.value}
            disabled={chosen !== null || !onSend}
            onClick={() => {
              setChosen(o.value);
              onSend?.(o.value);
            }}
            className={`${btnSmall} ${chosen === o.value ? "!border-brand-edge !bg-brand-bg !text-brand-text" : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {chosen !== null ? <p className="mt-1 text-xs text-muted">{t("bv.work.choose.sent")}</p> : null}
    </article>
  );
}
