import Link from "next/link";

import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { RESPONSIBILITIES, hhmm, type Employee } from "@/lib/employees/types";

import { btnMain, btnQuiet, fieldHelp, kvList } from "../../ui";
import type { Say } from "../../words";
import { WIZARD_LANGS, hoursOf, voicesFor, type Draft, type VoiceCatalogue } from "./draft";

/** Step 7: what was chosen, then "Turn on" (goes to the employee's page) or "Save and turn on later" (stays a draft; back to the list). */
export function StepOn({ t, d, employee, catalogue, base, busy, turnOn }: { t: Say; d: Draft; employee: Employee | null; catalogue: VoiceCatalogue; base: string; busy: boolean; turnOn: () => void }) {
  const hours = hoursOf(d);
  const langs = WIZARD_LANGS.filter((l) => d.languages.includes(l)).map((l) => `${CALL_LANG_NAMES[l]}: ${voicesFor(catalogue, l).find((v) => v.id === d.voices[l])?.name ?? t("emp.wiz.sum.voice_default")}`);
  const days = d.days.map((n) => t(`emp.day.${n}`)).join(" ");
  const jobs = RESPONSIBILITIES.filter((r) => d.responsibilities.includes(r)).map((r) => t(`emp.resp.${r}`));
  const rows: [string, string][] = [
    [t("emp.wiz.step.role"), d.roleTitle.trim() || (d.role ? t(`emp.role.${d.role}`) : "")],
    [t("emp.wiz.step.name"), employee?.name ?? d.name.trim()],
    [t("emp.wiz.sum.langs"), langs.join(" · ")],
    [t("emp.wiz.sum.ask"), d.askFirst.length ? d.askFirst.map((a) => t(`emp.ask.${a}`)).join(", ") : t("emp.wiz.sum.ask_none")],
    [t("emp.wiz.hours.h"), hours.ok && hours.hours ? t("emp.wiz.sum.hours_only", { days, from: hhmm(hours.hours.fromMinute), to: hhmm(hours.hours.toMinute) }) : t("emp.hours.same")],
    [t("emp.wiz.step.jobs"), jobs.length ? jobs.join(", ") : t("emp.wiz.sum.none")],
    [t("emp.wiz.never.h"), d.neverSay.length ? d.neverSay.join(", ") : t("emp.wiz.sum.none")],
  ];
  return (
    <div data-part="wiz-on" className="flex flex-col gap-4">
      <p className="m-0 text-[15px] text-muted">{t("emp.wiz.on.d")}</p>
      <dl className={`${kvList} m-0 rounded-xl border border-line bg-surface p-4`}>
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={turnOn} disabled={busy} data-part="wiz-turn-on" className={btnMain}>
          {t("emp.turn_on")}
        </button>
        <Link href={`${base}/employees`} prefetch={false} data-part="wiz-later" className={btnQuiet}>
          {t("emp.wiz.on.later")}
        </Link>
      </div>
      <p className={`${fieldHelp} m-0`}>{t("emp.wiz.on.later_note")}</p>
    </div>
  );
}
