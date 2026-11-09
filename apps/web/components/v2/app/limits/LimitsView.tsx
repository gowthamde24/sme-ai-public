import { ALWAYS, type Limits } from "@/lib/limits/model";

import { fill } from "../aiteam/shift";

type W = Readonly<Record<string, string>>;

/** Settings > Limits (read-only; see lib/limits/model.ts). Server markup: no script. "Always needs your OK" is fixed text; "It may do alone" is each real setting in words, or "Not shown yet". */
export function LimitsView({ limits, words }: { limits: Limits; words: W }) {
  const w = (k: string, vars?: Record<string, string>) => fill(words[k] ?? k, vars);
  return (
    <section aria-label={w("lim.title")} data-part="limits" className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5" data-part="always">
        <h2 className="m-0 font-display text-xl font-bold">{w("lim.always.t")}</h2>
        <p className="m-0 mt-1 text-sm text-muted">{w("lim.always.sub")}</p>
        <ul className="mt-3 flex list-none flex-col gap-2 p-0 text-base">
          {ALWAYS.map((k) => (
            <li key={k} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-[#ff773c]" />
              {w(k)}
            </li>
          ))}
        </ul>
        <p className="m-0 mt-3 text-sm font-semibold text-muted">{w("lim.always.fixed")}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5" data-part="alone">
        <h2 className="m-0 font-display text-xl font-bold">{w("lim.alone.t")}</h2>
        <p className="m-0 mt-1 text-sm text-muted">{w("lim.alone.sub")}</p>
        <ul className="mt-3 flex list-none flex-col gap-3 p-0 text-base">
          {limits.alone.map((f) => (
            <li key={f.key} data-ok={f.ok ? "" : undefined} className={f.ok ? "" : "text-muted"}>
              {f.ok ? w(f.key, f.vars) : `${w(`${f.key}.label`)}: ${w("lim.unread")}`}
            </li>
          ))}
          {limits.quiet ? <li data-part="quiet">{w(limits.quiet.key, limits.quiet.vars)}</li> : <li className="text-muted">{`${w("lim.quiet.label")}: ${w("lim.unread")}`}</li>}
        </ul>
        <p className="m-0 mt-3 text-sm text-muted">{w("lim.readonly")}</p>
      </div>
    </section>
  );
}
