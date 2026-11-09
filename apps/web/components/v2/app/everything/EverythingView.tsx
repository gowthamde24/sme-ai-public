"use client";

import Link from "next/link";
import * as React from "react";

import { routeTransport } from "@/lib/assistant-work/client";
import { KINDS, type Entry, type Kind } from "@/lib/everything/model";

import { fill } from "../aiteam/shift";
import { whenText } from "../settings/AssistantActivity";

type W = Readonly<Record<string, string>>;

/**
 * "Everything it did" (app v4 part 8): the merged timeline, filter chips by kind (with their counts), and Undo only on a row whose action the API says can be undone. A source that could not be read is said in words ("Not shown yet"),
 * never left out silently and never guessed. The words of a row are the page's own, filled with the API's own names and summaries.
 */
export function EverythingView({ entries, words, base, lang, missing, example }: { entries: readonly Entry[]; words: W; base: string; lang: string; missing: readonly Kind[]; example: boolean }) {
  const w = (k: string, vars?: Record<string, string>) => fill(words[k] ?? k, vars);
  const [kind, setKind] = React.useState<Kind | null>(null);
  const [gone, setGone] = React.useState<Record<string, "done" | "expired" | "error">>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const transport = React.useMemo(() => routeTransport(base), [base]);
  const shown = kind ? entries.filter((e) => e.kind === kind) : entries;
  const undo = async (e: Entry) => {
    if (!e.undo || busy) return;
    setBusy(e.id);
    const out = await transport.undoAction(e.undo);
    setBusy(null);
    setGone((g) => ({ ...g, [e.id]: out.ok ? "done" : out.error === "expired" ? "expired" : "error" }));
  };
  const count = (k: Kind) => entries.filter((e) => e.kind === k).length;
  return (
    <section aria-label={w("ev.title")} data-part="everything" className="mt-4 flex flex-col gap-4">
      {example ? (
        <p data-part="example-data" className="m-0 inline-flex w-fit items-center rounded-full border border-amber-text bg-amber-bg px-2.5 py-0.5 text-xs font-semibold text-amber-text">
          {w("ev.example")}
        </p>
      ) : null}
      <nav aria-label={w("ev.filter")} className="flex flex-wrap gap-2" data-part="chips">
        {[null, ...KINDS].map((k) => (
          <button key={k ?? "all"} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${kind === k ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-ink hover:bg-surface-2"}`}>
            {k ? w(`ev.kind.${k}`) : w("ev.all")} ({k ? count(k) : entries.length})
          </button>
        ))}
      </nav>
      {missing.length ? (
        <p role="note" className="m-0 text-sm text-muted" data-part="missing">
          {missing.map((k) => w("ev.missing", { kind: w(`ev.kind.${k}`) })).join(" · ")}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="m-0 rounded-[22px] border border-line bg-surface p-4 text-base text-muted">{w("ev.empty")}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col overflow-hidden rounded-[22px] border border-line bg-surface p-0 shadow-[var(--v2-shadow)]">
          {shown.map((e) => {
            const row = e.kind === "changes" ? e.vars.what : w(e.key, { ...e.vars, who: e.vars.who || w("ev.someone") });
            const state = gone[e.id];
            return (
              <li key={e.id} data-kind={e.kind} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0">
                <span className="w-32 shrink-0 text-sm text-muted tabular-nums">{whenText(lang, e.at)}</span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-base font-semibold [overflow-wrap:anywhere]">
                    {e.href ? (
                      <Link href={`${base}${e.href}`} className="hover:underline">
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </p>
                  <p className="m-0 text-sm text-muted">
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{w(`ev.kind.${e.kind}`)}</span>
                    {e.practice ? <span className="ml-2 font-semibold">{w("ev.practice")}</span> : null}
                    {e.outcome && e.outcome !== "done" ? <span className="ml-2 font-semibold text-amber-text">{w(`ev.out.${e.outcome}`)}</span> : null}
                    {e.detail ? <span className="ml-2 [overflow-wrap:anywhere]">{e.detail}</span> : null}
                  </p>
                </div>
                {e.undo && !state ? (
                  <button type="button" onClick={() => void undo(e)} disabled={busy !== null} data-part="undo" className="inline-flex min-h-11 items-center rounded-full border border-edge px-4 text-sm font-semibold hover:bg-surface-2 disabled:opacity-60">
                    {w("ev.undo")}
                  </button>
                ) : null}
                {state ? (
                  <p role="status" className={`m-0 text-sm font-semibold ${state === "done" ? "text-green-text" : "text-amber-text"}`}>
                    {w(state === "done" ? "ev.undo.done" : state === "expired" ? "ev.undo.expired" : "ev.undo.err")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
