import { AlertTriangle, Check } from "lucide-react";

import type { CheckResult, FixCode } from "@/lib/templates/meta-checks";
import { GREETING } from "@/lib/templates/meta-checks";

import { JobChip } from "../../ds/JobChip";
import type { Say } from "../../words";
import { jobBtnQuiet, jobBtnMain } from "../../jobs/detail/types";

/** The numbers and words a check's sentence takes: a language, a part and a group are words of ours, in the person's language. */
export function checkParams(r: CheckResult, t: Say, group: string): Record<string, string | number> {
  const p: Record<string, string | number> = { ...r.params };
  p.lang = t(`jobs.tb.lang.${r.langs[0] ?? "en"}`);
  if (typeof r.params.part === "string") p.part = t(`jobs.tb.part.${r.params.part}`);
  p.group = group;
  if (typeof r.params.lang === "string") p.lang = t(`jobs.tb.lang.${r.params.lang}`);
  return p;
}

const fixParams = (fix: FixCode, r: CheckResult): Record<string, string | number> => (fix === "greet_first" ? { greeting: String(r.params.greeting ?? GREETING.en) } : { ...r.params });

/**
 * THE AUTOMATIC CHECKS, as a list: a green tick or an amber warning for each (the plain sentence, with the one-tap Fix when there is one), a solid chip with how many to fix, and "Fix all". Nothing is checked here: the results come from the pure function in
 * lib/templates/meta-checks.ts. Amber warnings come first; the legend says what the colours mean.
 */
export function MessageChecks({ results, t, canFix, onFix, onFixAll }: { results: readonly CheckResult[]; t: Say; canFix: boolean; onFix: (r: CheckResult) => void; onFixAll: () => void }) {
  const warn = results.filter((r) => r.status === "warn");
  const ordered = [...warn, ...results.filter((r) => r.status === "ok")];
  const category = results.find((r) => r.code === "category");
  const group = t(`jobs.tb.cat.${category?.params.category === "marketing" ? "marketing" : "utility"}`);
  const fixable = warn.filter((r) => r.fix !== null);
  return (
    <div data-part="checks" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {warn.length > 0 ? <JobChip tone="wait">{t("jobs.tb.s4.fix_n", { n: warn.length })}</JobChip> : <JobChip tone="done">{t("jobs.tb.s4.allgood")}</JobChip>}
        {canFix && fixable.length > 1 ? (
          <button type="button" data-action="fix-all" onClick={onFixAll} className={jobBtnMain}>
            {t("jobs.tb.s4.fix_all")}
          </button>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {ordered.map((r) => {
          const bad = r.status === "warn";
          const Icon = bad ? AlertTriangle : Check;
          return (
            <li key={r.code} data-check={r.code} data-status={r.status} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
              <span aria-hidden="true" className={`mt-0.5 grid size-7 place-items-center rounded-full ${bad ? "bg-[var(--jb-wait-bg)] text-[var(--jb-wait-fg)]" : "bg-[var(--jb-done-bg)] text-[var(--jb-done-fg)]"}`}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[15px] font-semibold leading-snug text-ink">{t(`jobs.tb.check.${r.code}.title`, { group })}</p>
                <p className="m-0 mt-0.5 text-[14px] leading-snug text-muted">{t(r.key, checkParams(r, t, group))}</p>
                {bad && r.fix && canFix ? (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-[var(--jb-wait-soft)] px-3 py-2">
                    <span className="min-w-0 text-[14px] font-semibold leading-snug text-ink">{t(`jobs.tb.fix.${r.fix}`, fixParams(r.fix, r))}</span>
                    <button type="button" data-action="fix" data-fix={r.fix} onClick={() => onFix(r)} className={`${jobBtnQuiet} shrink-0`}>
                      {t("jobs.tb.s4.fix")}
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-[13px] leading-snug text-muted">{t("jobs.tb.s4.legend")}</p>
    </div>
  );
}
