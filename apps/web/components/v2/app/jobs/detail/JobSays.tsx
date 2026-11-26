"use client";

import { Mic } from "lucide-react";
import Link from "next/link";

import type { JobSays, JobSetting } from "@/lib/jobs/detail";

import type { Say } from "../../words";
import { SettingLineView } from "./SettingLines";
import { jobBtnQuiet, jobCard, jobH2 } from "./types";

/** The words that go to the customer, with the real business name and the AI disclosure (composed by the API; the page only shows them), the language choice, and "Change by saying it". */
export function JobSaysCard({ says, language, values, t, disabled, byKey, jobName, base, onChange }: { says: readonly JobSays[]; language: JobSetting | undefined; values: Readonly<Record<string, string>>; t: Say; disabled: boolean; byKey: ReadonlyMap<string, JobSetting>; jobName: string; base: string; onChange: (key: string, value: string) => void }) {
  const chosen = values.language ?? "customer";
  const entry = says.find((s) => s.language === chosen) ?? says[0];
  // "Change by saying it": Today's assistant takes the sentence (Today reads `say`); until it does, the link still lands on the assistant's own box.
  const href = `${base}?say=${encodeURIComponent(`${t("jobs.job.say_prefill", { name: jobName })} `)}`;
  return (
    <section data-part="job-says" className={jobCard}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={jobH2}>{t("jobs.page.says")}</h2>
        {disabled ? null : (
          <Link href={href} prefetch={false} className={`${jobBtnQuiet} no-underline`}>
            <Mic aria-hidden="true" className="size-4" />
            {t("jobs.page.says_change")}
          </Link>
        )}
      </div>
      {entry ? (
        <div className="mt-3">
          <p className="m-0 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            {t(`jobs.job.ch.${entry.channel}`)} · {t(`jobs.opt.language.${entry.language}`)}
          </p>
          <p data-part="bubble" className="m-0 rounded-xl rounded-tl-sm border border-line bg-surface-2 px-3.5 py-3 text-[15px] leading-relaxed text-ink">
            “{entry.text}”
          </p>
        </div>
      ) : null}
      {language ? (
        <div className="mt-2">
          <SettingLineView line={{ id: "language", keys: ["language"] }} byKey={byKey} values={values} t={t} disabled={disabled} onChange={onChange} />
        </div>
      ) : null}
    </section>
  );
}
