"use client";

import * as React from "react";

import type { AiTeamDay, Helper } from "@/lib/api/ai-team";

import type { SwitchFn } from "./HelperPanel";
import { HelperPanel } from "./LazyHelperPanel";
import { LANE_TONE, fill, statusWords } from "./shift";

/**
 * The Helpers tab (app v4 part 7): one card for each helper of the business, with whether it is on, its live status and today's count; a tap opens the same side panel as a lane of the shift (its last actions, numbers, rules and the
 * switch). The numbers are the day's own (the page reads them when it draws; the shift tab is the one that follows them live).
 */
export function HelpersTab({ tenantId, base, day, words, manages, onSwitch, mfaHref }: { tenantId: string; base: string; day: AiTeamDay; words: Readonly<Record<string, string>>; manages: boolean; onSwitch: SwitchFn | null; mfaHref: string }) {
  const w = (k: string, vars?: Record<string, string>) => fill(words[k] ?? k, vars);
  const [open, setOpen] = React.useState<Helper | null>(null);
  return (
    <section aria-label={w("aiteam.v4.tab.helpers")} className="mt-4" data-part="helpers">
      <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {day.lanes.map((lane) => {
          const name = w(`aiteam.helper.${lane.helper}`);
          const s = statusWords(lane.statusNow, null);
          return (
            <li key={lane.helper}>
              <button type="button" onClick={() => setOpen(lane.helper)} aria-label={w("aiteam.open", { helper: name })} data-helper={lane.helper} className="flex min-h-24 w-full flex-col gap-2 rounded-[22px] border border-line bg-surface p-4 text-left shadow-[var(--v2-shadow)] hover:border-brand-edge">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-display text-lg font-bold">
                    <span aria-hidden="true" className={`size-3 rounded-full ${LANE_TONE[lane.helper].dot}`} />
                    {name}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${lane.enabled ? "bg-green-bg text-green-text" : "bg-surface-2 text-muted"}`}>{lane.enabled ? w("aiteam.panel.on") : w("aiteam.panel.off")}</span>
                </span>
                <span className="text-sm text-muted">{s ? w(s.key, s.vars) : ""}</span>
                <span className="text-sm font-semibold tabular-nums">{w("aiteam.count", { count: String(lane.countToday) })}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {open ? <HelperPanel key={open} tenantId={tenantId} base={base} helper={open} name={w(`aiteam.helper.${open}`)} words={words} manages={manages} onSwitch={onSwitch} mfaHref={mfaHref} onClose={() => setOpen(null)} onChanged={() => undefined} /> : null}
    </section>
  );
}
