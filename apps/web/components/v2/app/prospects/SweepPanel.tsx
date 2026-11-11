import { formatRupeesShort } from "@/lib/money";
import { hourWord, skipKey, stampIst, type Sweep, type SweepList, type SweepRun } from "@/lib/lead-finder/sweeps";

import { mutedText, surface } from "../ui";
import type { Words } from "../words";
import { SweepAdd, SweepControls } from "./LazySweep";
import type { SweepActionsIn } from "./SweepControls";

/**
 * The Lead Finder's weekly search, on the Prospects page (job sweep-screens; C1's PROPOSAL docs/contracts/lead-finder-sweep.md): each saved search with when it runs, what the last run found ("6 new businesses this week") or why it did
 * not run, what it costs, and (Owner, Admin) Pause / Resume, Run now, Change, Remove and "Add a weekly search". A weekly search NEVER dials anyone; the page says so. Server markup: the page reads the data; the buttons are lazy client parts.
 * `demo` = the test mode (made-up searches in a cookie): the page says so.
 */
const stamp = stampIst;

function lastLine(w: Words, r: SweepRun, lang: string): string {
  if (r.state === "skipped") return `${w["sw.last"].replace("{when}", stamp(r.startedAt, lang))} ${w[skipKey(r.skipReason)]}`;
  if (r.state === "failed") return `${w["sw.last"].replace("{when}", stamp(r.startedAt, lang))} ${w["sw.last.failed"]}`;
  const n = r.newSinceLastRun;
  const head = w[n === 1 ? "sw.new.one" : "sw.new.other"].replace("{n}", String(n));
  const c = r.counts;
  const tail = c ? ` · ${w["sw.counts"].replace("{found}", String(c.found)).replace("{dup}", String(c.duplicates)).replace("{needs}", String(c.needsOwner))}` : "";
  return `${head}${tail}`;
}

function costLine(w: Words, s: Sweep, budget: number): string {
  if (s.provider === "fixture" || s.estCostPaise === 0) return w["sw.cost.none"];
  const amount = formatRupeesShort(s.estCostPaise);
  const line = w[s.costIsEstimate ? "sw.cost.est" : "sw.cost.is"].replace("{amount}", amount);
  return budget <= 0 ? `${line} ${w["sw.cost.nobudget"]}` : line;
}

function Card({ s, runs, w, lang, list, controls }: { s: Sweep; runs: readonly SweepRun[]; w: Words; lang: string; list: SweepList; controls: React.ReactNode }) {
  const earlier = runs.filter((r) => r.id !== s.lastRun?.id).slice(0, 3);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 [overflow-wrap:anywhere]" data-sweep={s.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="m-0 font-display text-base font-bold">
          {s.query} · {s.area}
        </h3>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${s.enabled ? "bg-green-bg text-green-text" : "bg-surface-2 text-muted"}`} data-part="sweep-state">
          {w[s.enabled ? "sw.on" : "sw.off"]}
        </span>
      </div>
      <p className="m-0 text-sm">
        {w["sw.when"].replace("{day}", w[`sw.day.${s.weekday}`]).replace("{time}", hourWord(s.hour))} · {w["sw.cap"].replace("{n}", String(s.maxResults))}
      </p>
      <p className="m-0 text-sm text-muted">{s.enabled && s.nextRunAt ? w["sw.next"].replace("{when}", stamp(s.nextRunAt, lang)) : w["sw.paused"]}</p>
      <p className="m-0 text-sm font-semibold" data-part="sweep-last">
        {s.lastRun ? lastLine(w, s.lastRun, lang) : w["sw.last.none"]}
      </p>
      <p className="m-0 text-sm text-muted">
        {costLine(w, s, list.weeklyBudgetPaise)}
        {s.attribution ? ` · ${s.attribution}` : ""}
      </p>
      {earlier.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-brand-text">{w["sw.earlier"]}</summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-muted">
            {earlier.map((r) => (
              <li key={r.id}>
                {stamp(r.startedAt, lang)}: {r.state === "done" ? w[r.newSinceLastRun === 1 ? "sw.new.one" : "sw.new.other"].replace("{n}", String(r.newSinceLastRun)) : r.state === "skipped" ? w[skipKey(r.skipReason)] : w["sw.last.failed"]}
                {r.trigger === "owner" ? ` (${w["sw.by.you"]})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {controls}
    </li>
  );
}

export function SweepPanel({ read, w, lang, canChange, demo, actions, settingsHref }: { read: SweepList & { runs: Record<string, SweepRun[]> }; w: Words; lang: string; canChange: boolean; demo: boolean; actions: SweepActionsIn; settingsHref: string }) {
  const full = read.items.length >= read.maxSweeps;
  return (
    <section aria-labelledby="sw-h" className={`${surface} flex flex-col gap-4`} data-part="sweeps">
      <div>
        <h2 id="sw-h" className="m-0 font-display text-lg font-bold">
          {w["sw.title"]}
        </h2>
        <p className={`${mutedText} m-0 mt-1`}>{w["sw.sub"]}</p>
        <p className="m-0 mt-1 text-sm font-semibold">{w["sw.nocall"]}</p>
        {demo ? (
          <p role="note" className="m-0 mt-2 text-sm font-semibold text-info-text" data-demo="">
            {w["sw.mock"]}
          </p>
        ) : null}
      </div>
      {read.items.length === 0 ? (
        <p className={`${mutedText} m-0`}>{w["sw.none"]}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {read.items.map((s) => (
            <Card
              key={s.id}
              s={s}
              runs={read.runs[s.id] ?? []}
              w={w}
              lang={lang}
              list={read}
              controls={canChange ? <SweepControls w={w} sweepId={s.id} enabled={s.enabled} weekday={s.weekday} hour={s.hour} maxResults={s.maxResults} actions={{ change: actions.change, run: actions.run, remove: actions.remove }} /> : null}
            />
          ))}
        </ul>
      )}
      {canChange ? full ? <p className={`${mutedText} m-0`}>{w["sw.err.limit"]}</p> : <SweepAdd w={w} add={actions.add} preview={actions.preview} lang={lang} settingsHref={settingsHref} /> : null}
      <p className={`${mutedText} m-0`}>{w["sw.budget"].replace("{amount}", formatRupeesShort(read.weeklyBudgetPaise))}</p>
    </section>
  );
}
