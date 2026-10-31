"use client";

import Link from "next/link";
import * as React from "react";

import { say, type TodayWords } from "./today-words";
import type { Digest } from "./types";

const card = "flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-5";

function Title({ words }: { words: TodayWords }) {
  return (
    <h2 id="done-heading" className="font-display text-xl font-semibold">
      {say(words, "today.done.title")}
    </h2>
  );
}

function Loaded({ digest, words, outboxHref }: { digest: Promise<Digest>; words: TodayWords; outboxHref: string | null }) {
  const d = React.use(digest);
  if (d.state === "none") return null; // a person who may not read the outbox is not shown the section
  return (
    <section aria-labelledby="done-heading" data-part="done" className={card}>
      <Title words={words} />
      {d.state === "error" ? (
        <p className="text-sm text-muted">{say(words, "frame.notyet")}</p>
      ) : d.lines.length === 0 ? (
        <p className="text-base text-muted">{say(words, "today.done.empty")}</p>
      ) : (
        // the owner's target (31 Oct): ONE line, what was done, as short sentences side by side
        <p data-line="done" className="text-base text-muted [overflow-wrap:anywhere]">
          {d.lines.map((l) => say(words, `today.done.${l.kind}.${l.n === 1 ? "one" : "other"}`, { n: l.n, time: l.time ?? "" })).join(" · ")}
        </p>
      )}
      {outboxHref ? (
        <Link href={outboxHref} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">
          {say(words, "today.done.link")}
        </Link>
      ) : null}
    </section>
  );
}

/**
 * "Done while you slept" (job AU): what the Agent OWL sent in the last 24 hours, at most four lines, from the outbox log (the counts of each kind of message, never their words). It is read under
 * a Suspense of its own, so the rest of Today does not wait for it; while it loads the card is a few pulsing lines; a person who may not read the log is not shown the section. `outboxHref` is the
 * outbox page ("See everything in the outbox"): there is none yet, so without it the link is not drawn.
 */
export function DoneSection({ digest, words, outboxHref }: { digest: Promise<Digest> | null; words: TodayWords; outboxHref: string | null }) {
  if (digest === null) return null;
  return (
    <React.Suspense
      fallback={
        <section aria-labelledby="done-heading" aria-busy="true" className={card}>
          <Title words={words} />
          <div aria-hidden="true" className="flex flex-col gap-3">
            {[0].map((i) => (
              <span key={i} className="h-5 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        </section>
      }
    >
      <Loaded digest={digest} words={words} outboxHref={outboxHref} />
    </React.Suspense>
  );
}
