import type { Limits } from "@/lib/limits/model";

import { fill } from "../aiteam/shift";

type W = Readonly<Record<string, string>>;

/** Settings > Limits (read-only; see lib/limits/model.ts). Server markup: no script. A kind the API says is locked is fixed text with no toggle; the rest say what the owner's settings decide; unreadable is "Not shown yet". */
export function LimitsView({ limits, words }: { limits: Limits | null; words: W }) {
  const w = (k: string, vars?: Record<string, string>) => fill(words[k] ?? k, vars);
  if (limits === null) {
    return (
      <p role="note" className="m-0 rounded-xl border border-line bg-surface p-4 text-base text-muted" data-part="limits-unread">
        {w("lim.title")}: {w("lim.unread")}
      </p>
    );
  }
  return (
    <section aria-label={w("lim.title")} data-part="limits" className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5" data-part="always">
        <h2 className="m-0 font-display text-xl font-bold">{w("lim.always.t")}</h2>
        <p className="m-0 mt-1 text-sm text-muted">{w("lim.always.sub")}</p>
        <ul className="mt-3 flex list-none flex-col gap-2 p-0 text-base">
          {limits.always.map((k) => (
            <li key={k} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-[#ff773c]" />
              {w(`lim.kind.${k}`)}
            </li>
          ))}
        </ul>
        <p className="m-0 mt-3 text-sm font-semibold text-muted">{w("lim.always.fixed")}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5" data-part="alone">
        <h2 className="m-0 font-display text-xl font-bold">{w("lim.alone.t")}</h2>
        <p className="m-0 mt-1 text-sm text-muted">{w("lim.alone.sub")}</p>
        <ul className="mt-3 flex list-none flex-col gap-3 p-0 text-base">
          <li data-part="workspace">{w(`lim.ws.${limits.workspace}`)}</li>
          {limits.decided.map((d) => (
            <li key={d.kind} data-kind={d.kind}>
              {w(d.alone ? "lim.mode.alone" : "lim.mode.asks", { what: w(`lim.kind.${d.kind}`) })}
            </li>
          ))}
          {limits.caps.map((c) => (
            <li key={c.key} data-cap={c.key}>
              {c.vars.n === "" ? w(`${c.key}.none`) : w(c.key, c.vars)}
            </li>
          ))}
          {limits.hours.map((h) => (
            <li key={h.key} data-part="hours">
              {w(h.key, { ...h.vars, days: h.vars.days ? h.vars.days.split(",").map((d) => w(`lim.day.${d}`)).join(", ") : "" })}
            </li>
          ))}
        </ul>
        {limits.assistantSaved ? null : <p className="m-0 mt-3 text-sm text-muted">{w("lim.notsaved")}</p>}
        <p className="m-0 mt-3 text-sm text-muted">{w("lim.readonly")}</p>
      </div>
    </section>
  );
}
