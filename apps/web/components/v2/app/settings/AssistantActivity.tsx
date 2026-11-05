"use client";

import { Undo2 } from "lucide-react";
import * as React from "react";

import { fixtureTransport, routeTransport, type WorkTransport } from "@/lib/assistant-work/client";
import type { ActivityEntry } from "@/lib/assistant-work/types";

import { dayText } from "../date-words";
import { makeT, type Words } from "../words";

const IST = 5.5 * 3600_000;
/** "4 Nov, 2:10 pm" in India time, the date in the person's language. */
export function whenText(lang: string, iso: string): string {
  const local = new Date(Date.parse(iso) + IST);
  const h = local.getUTCHours();
  const m = String(local.getUTCMinutes()).padStart(2, "0");
  return `${dayText(lang, local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), { month: "short" })}, ${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "am" : "pm"}`;
}

const pillOf = { done: "border-green-text bg-green-bg text-green-text", failed: "border-red-text bg-red-bg text-red-text", undone: "border-line bg-surface-2 text-muted" } as const;

/**
 * Settings > Activity: what the assistant changed, "by the assistant, on <name>'s request", newest first, filtered to today or this week, with Undo where the action declares one (the Owner's; the API
 * checks again). The list is the API's (C1's contract, docs/contracts/assistant-tools.md: `GET /assistant/actions`); null = it could not be read ("Not available yet"), never a guess. In `mock` mode
 * the entries are examples and the card says so.
 */
export function AssistantActivity({ entries, range, words, lang, base, canUndo, mode, transport: given }: { entries: readonly ActivityEntry[] | null; range: "today" | "week"; words: Words; lang: string; base: string; canUndo: boolean; mode: "on" | "mock"; transport?: WorkTransport }) {
  const t = React.useMemo(() => makeT(words), [words]);
  const transport = React.useMemo(() => given ?? (mode === "on" ? routeTransport(base) : fixtureTransport()), [given, mode, base]);
  const [changed, setChanged] = React.useState<Record<string, ActivityEntry>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<{ id: string; key: string } | null>(null);
  const undo = async (id: string) => {
    setBusy(id);
    setProblem(null);
    const out = await transport.undoAction(id);
    setBusy(null);
    if (out.ok) setChanged((m) => ({ ...m, [id]: out.entry }));
    else setProblem({ id, key: out.error === "expired" ? "asstact.undo.expired" : out.error === "forbidden" ? "asstact.undo.forbidden" : "asstact.undo.err" });
  };
  const tab = (r: "today" | "week") => (
    <a href={`${base}/settings?section=activity&range=${r}`} aria-current={range === r ? "page" : undefined} data-range={r} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${range === r ? "border-brand-edge bg-brand-bg text-brand-text" : "border-edge bg-surface text-ink hover:bg-surface-2"}`}>
      {t(`asstact.filter.${r}`)}
    </a>
  );
  return (
    <section data-section="assistant-activity" aria-labelledby="asstact-title" className="rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5">
      <h2 id="asstact-title" className="font-display text-xl font-bold">
        {t("asstact.title")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("asstact.intro")}</p>
      {mode === "mock" ? (
        <p role="note" className="mt-3 rounded-lg border border-line bg-info-bg p-3 text-sm font-medium text-info-text">
          {t("asstact.example")}
        </p>
      ) : null}
      <nav aria-label={t("asstact.filter.label")} className="mt-3 flex flex-wrap gap-2">
        {tab("today")}
        {tab("week")}
      </nav>
      {entries === null ? <p className="mt-4 text-sm text-muted">{t("asstact.unavailable")}</p> : null}
      {entries !== null && entries.length === 0 ? <p className="mt-4 text-sm text-muted">{t(`asstact.empty.${range}`)}</p> : null}
      {entries !== null && entries.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3">
          {entries.map((given) => {
            const e = changed[given.actionId] ?? given;
            return (
              <li key={e.actionId} data-activity={e.tool} data-status={e.status} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 flex-1 text-base font-semibold [overflow-wrap:anywhere]">{e.summary}</p>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold ${pillOf[e.status]}`}>{t(`asstact.status.${e.status}`)}</span>
                </div>
                {e.changed ? <p className="mt-1 text-sm [overflow-wrap:anywhere]">{t("asstact.changed", { what: e.changed })}</p> : null}
                {e.status === "failed" && e.error ? (
                  <p data-activity="error" className="mt-1 text-sm font-medium text-red-text">
                    {t("asstact.error", { why: t(`bv.work.step.err.${e.error}`) })}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-muted">
                  {e.requestedBy ? t("asstact.by", { name: e.requestedBy }) : t("asstact.by.you")}
                  {" · "}
                  <time dateTime={e.at}>{whenText(lang, e.at)}</time>
                </p>
                {e.undo === "available" && canUndo ? (
                  <button type="button" data-activity="undo" data-write disabled={busy === e.actionId} onClick={() => void undo(e.actionId)} className="mt-2 inline-flex min-h-11 items-center justify-center gap-1 rounded-full border border-edge bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-60">
                    <Undo2 className="size-4" aria-hidden="true" />
                    {busy === e.actionId ? t("asstact.undoing") : t("asstact.undo")}
                  </button>
                ) : null}
                {problem?.id === e.actionId ? (
                  <p role="alert" className="mt-2 text-sm font-medium text-red-text">
                    {t(problem.key)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
