"use client";

import * as React from "react";

import type { Activity, ActivityUsage, HookFail } from "@/lib/api/webhooks-out";

import { btnQuiet } from "../ui";
import { makeT, type Words } from "../words";

/**
 * Settings > Developers > Activity (C1's docs/contracts/developer-api.md): today's and this month's counts, the limits of each key in one sentence, and the requests of the last 30 days (method, the route template, the status, how long it took, which key). No request contents exist to show.
 */
export function ActivityTab({ words, usage, first, load }: { words: Words; usage: ActivityUsage | null; first: Activity | null; load: (before: string) => Promise<({ ok: true; activity: Activity }) | HookFail> }) {
  const t = makeT(words);
  const [items, setItems] = React.useState(first?.items ?? []);
  const [next, setNext] = React.useState(first?.nextBefore ?? null);
  const [busy, setBusy] = React.useState(false);
  const [bad, setBad] = React.useState(false);
  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  const cols = [
    ["dvh.use.requests", "requests"],
    ["dvh.use.leads", "leads"],
    ["dvh.use.calls", "calls"],
    ["dvh.use.errors", "errors"],
  ] as const;
  return (
    <div className="flex flex-col gap-4" data-part="dev-activity">
      <p className="m-0 text-[15px] text-muted">{t("dvh.act.sub")}</p>
      {usage ? (
        <>
          <table className="w-full border-collapse text-[15px]">
            <thead>
              <tr className="border-b border-ink text-left text-sm text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  <span className="sr-only">{t("dvh.act.title")}</span>
                </th>
                {cols.map(([k]) => (
                  <th key={k} scope="col" className="px-2 py-2 text-right font-semibold">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["today", "month"] as const).map((r) => (
                <tr key={r} className="border-b border-line">
                  <th scope="row" className="py-3 pr-3 text-left font-semibold text-ink">
                    {t(r === "today" ? "dvh.use.today" : "dvh.use.month")}
                  </th>
                  {cols.map(([k, f]) => (
                    <td key={k} className="px-2 py-3 text-right font-bold text-ink">
                      {usage[r][f].toLocaleString("en-IN")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {usage.limits ? <p className="m-0 text-[14px] text-muted">{t("dvh.use.limits", { r: usage.limits.requestsPerMinute, c: usage.limits.callsPerMinute, n: usage.limits.concurrentCalls })}</p> : null}
        </>
      ) : null}
      {items.length === 0 ? (
        <p className="m-0 border-y border-line py-4 text-[15px] text-muted">{t("dvh.act.none")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col border-t border-ink p-0">
          {items.map((r) => (
            <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-line py-2.5 text-[14px]">
              <span lang="en" className="break-all font-mono text-ink">
                {r.method} {r.route}
              </span>
              <b className={r.status >= 400 ? "text-ink" : "text-muted"}>{r.status}</b>
              <span className="text-muted">
                {r.keyName ? `${r.keyName} · ` : ""}
                {when(r.at)}
              </span>
              <span className="text-right text-muted">{r.latencyMs} ms</span>
            </li>
          ))}
        </ul>
      )}
      {bad ? (
        <p role="alert" className="m-0 text-[15px] font-semibold text-ink">
          {t("dvh.fail.unavailable")}
        </p>
      ) : null}
      {next ? (
        <button
          type="button"
          disabled={busy}
          className={`${btnQuiet} self-start`}
          onClick={async () => {
            setBusy(true);
            const r = await load(next);
            setBusy(false);
            if (r.ok) {
              setItems((c) => [...c, ...r.activity.items]);
              setNext(r.activity.nextBefore);
              setBad(false);
            } else setBad(true);
          }}
        >
          {t("dvh.act.more")}
        </button>
      ) : null}
    </div>
  );
}
