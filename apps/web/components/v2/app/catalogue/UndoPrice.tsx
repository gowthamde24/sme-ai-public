"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { say, type TodayWords } from "../today/today-words";

type Undo = () => Promise<{ ok: true } | { ok: false; error: "nothing_to_undo" | "forbidden" | "invalid" | "mfa_required" | "down" }>;

/** "Undo price change" (the Owner only, for 30 days after a change): one button and, after it, one plain line; the page is read again so the price shown is the one put back. */
export function UndoPrice({ undo, words }: { undo: Undo; words: TodayWords }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [line, setLine] = React.useState<string | null>(null);
  const [gone, setGone] = React.useState(false);
  if (gone) return line ? <p role="status" className="m-0 text-[15px] text-muted">{line}</p> : null;
  return (
    <div data-part="undo-price" className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await undo();
            if (r.ok) {
              setLine(say(words, "catalogue.price.undone"));
              setGone(true);
              router.refresh();
            } else setLine(say(words, r.error === "nothing_to_undo" ? "catalogue.price.nothing" : r.error === "forbidden" ? "catalogue.price.owner_only" : "catalogue.price.down"));
          })
        }
        className="inline-flex min-h-11 items-center rounded-lg border border-edge px-4 text-base font-semibold text-ink hover:bg-surface-2 disabled:opacity-60"
      >
        {say(words, "catalogue.price.undo")}
      </button>
      {line ? (
        <p role="status" className="m-0 text-[15px] text-muted">
          {line}
        </p>
      ) : null}
    </div>
  );
}
