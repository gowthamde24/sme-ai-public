"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { effectOf, fmtMinutes, linesOf, testWord, type Ago, type JobDetail, type JobFaq, type JobSays } from "@/lib/jobs/detail";
import { jobNameKey, type JobStatus } from "@/lib/jobs/types";
import { groupIndian } from "@/lib/money";

import { makeT, type Words } from "../../words";
import { FailureCard, FaqCard, FindsOutCard, TryCard, WhoTalks } from "./LazyJobLists";
import { JobHeader } from "./JobHeader";
import { ResultsCard } from "./JobResults";
import { JobSaysCard } from "./JobSays";
import { SettingLineView } from "./SettingLines";
import { jobCard, type JobPageActions, type WhoExtra } from "./types";

type Toast = { id: number; text: string; undo: () => Promise<void> };

/**
 * ONE job's page (JOBS, mocks 04, 06 and 09): the job and its switch, When (sentences with the choice inside, and what it will do), What it says, What it finds out, FAQs, More choices, Results, and "Try it".
 * Every change answers at once (optimistic) and is put back, with the reason, if the API says no. A rename or a switch also leaves an Undo for a few seconds. `actions` null = the person only reads.
 */
/** The parts of the page that can be left out when the API's answer for them cannot be read (parseJobDetail `unavailable`): each is said in plain words, the rest of the page works (planner, 20 Nov). */
const PART_WORD = { says: "jobs.job.part.says", settings: "jobs.job.part.settings", results: "jobs.job.part.results", faqs: "jobs.job.part.faqs", cost: "jobs.job.part.cost", findsOut: "jobs.job.part.finds" } as const;
const PART_KEYS = Object.keys(PART_WORD) as (keyof typeof PART_WORD)[];

export function JobPage({ detail, words, base, lang, ago, actions, allSettingsHref = null, whoExtra = null }: { detail: JobDetail; words: Words; base: string; lang: string; ago: Ago | null; actions: JobPageActions | null; /** The old page that holds every setting of this job (JOBS on: Rules and Campaigns redirect to the job, this link opens them with ?all=1), or null. */ allSettingsHref?: string | null; /** The Who talks card's extras (the voice sample route, the other job the command offers, the change of any job); null = no play buttons and no command. */ whoExtra?: WhoExtra | null }) {
  const t = makeT(words);
  const { job } = detail;
  const canChange = actions !== null;
  const [now, setNow] = useState<{ customName: string | null; enabled: boolean; status: JobStatus }>({ customName: job.customName, enabled: job.enabled, status: job.status });
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(detail.settings.map((s) => [s.key, s.value])));
  const [finds, setFinds] = useState<Record<string, boolean>>(() => Object.fromEntries(detail.findsOut.map((f) => [f.key, f.enabled])));
  const [faqs, setFaqs] = useState<readonly JobFaq[]>(detail.faqs);
  const [says, setSays] = useState<readonly JobSays[]>(detail.says);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  // the settings the API refused (`setting_invalid` names them in `fields`): marked until the next change
  const [badKeys, setBadKeys] = useState<readonly string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const plainName = t(jobNameKey(job.kind));
  const shownName = now.customName ?? plainName;
  const fail = (part: string, text: string | null) => setErrors((e) => ({ ...e, [part]: text }));

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast((cur) => (cur && cur.id === toast.id ? null : cur)), 8000);
    return () => clearTimeout(id);
  }, [toast]);
  const say = (text: string, undo: () => Promise<void>) => setToast({ id: ++seq.current, text, undo });

  const byKey = useMemo(() => new Map(detail.settings.map((s) => [s.key, s])), [detail.settings]);
  const language = byKey.get("language");
  const main = detail.settings.filter((s) => !s.more && s.key !== "language");
  const more = detail.settings.filter((s) => s.more && s.key !== "language");
  const effect = effectOf(job.kind, values, detail.effectInputs);

  async function switchTo(next: boolean, quiet = false): Promise<void> {
    if (!actions) return;
    const before = now;
    setNow({ ...now, enabled: next, status: next ? (before.status === "paused" ? "running" : before.status) : "paused" });
    setBusy(true);
    fail("header", null);
    const r = await actions.setEnabled(next);
    setBusy(false);
    if (!r.ok) {
      setNow(before);
      fail("header", r.error);
      return;
    }
    setNow((cur) => ({ ...cur, enabled: r.data.enabled, status: r.data.status }));
    if (!quiet) say(t(next ? "jobs.job.toast.on" : "jobs.job.toast.off"), () => switchTo(!next, true));
  }

  async function renameTo(name: string, quiet = false): Promise<boolean> {
    if (!actions) return false;
    const before = now.customName;
    fail("header", null);
    const r = await actions.rename(name);
    if (!r.ok) {
      fail("header", r.error);
      return false;
    }
    setNow((cur) => ({ ...cur, customName: r.data.customName }));
    if (r.data.says) setSays(r.data.says);
    if (!quiet) say(r.data.customName ? t("jobs.job.toast.renamed", { name: r.data.customName }) : t("jobs.job.toast.plain"), async () => void (await renameTo(before ?? "", true)));
    return true;
  }

  async function choose(key: string, value: string) {
    if (!actions) return;
    const before = values[key];
    setValues((v) => ({ ...v, [key]: value }));
    fail("settings", null);
    setBadKeys([]);
    // a tick is a toggle: true/false on the wire (the page keeps "on"/"off")
    const r = await actions.setSetting(key, byKey.get(key)?.type === "toggle" ? value === "on" : value);
    if (!r.ok) {
      setValues((v) => ({ ...v, [key]: before }));
      fail("settings", r.error);
      setBadKeys(r.fields && r.fields.length > 0 ? r.fields : [key]);
    }
  }
  async function tick(key: string, on: boolean) {
    if (!actions) return;
    const before = finds[key] ?? false;
    setFinds((f) => ({ ...f, [key]: on }));
    fail("finds", null);
    const r = await actions.setFindsOut(key, on);
    if (!r.ok) {
      setFinds((f) => ({ ...f, [key]: before }));
      fail("finds", r.error);
    }
  }
  async function addFaq(q: string, a: string): Promise<boolean> {
    if (!actions) return false;
    fail("faqs", null);
    const r = await actions.addFaq(q, a);
    if (!r.ok) {
      fail("faqs", r.error);
      return false;
    }
    setFaqs((l) => [...l, r.data]);
    return true;
  }
  async function removeFaq(id: string) {
    if (!actions) return;
    const before = faqs;
    setFaqs((l) => l.filter((f) => f.id !== id));
    fail("faqs", null);
    const r = await actions.removeFaq(id);
    if (!r.ok) {
      setFaqs(before);
      fail("faqs", r.error);
    }
  }
  async function test(): Promise<{ ok: boolean; text: string; quiet?: boolean }> {
    if (!actions || !detail.test) return { ok: false, text: "" };
    const r = await actions.test(detail.test);
    // outside 9 am to 9 pm the API refuses (`409 quiet_hours`): the button goes off and the sentence says when tests are sent
    if (!r.ok) return r.code === "quiet_hours" ? { ok: false, text: t("jobs.job.test.quiet"), quiet: true } : { ok: false, text: r.error };
    const sent = t(r.data.sent ? `jobs.job.test.sent_${testWord(r.data.channel)}` : "jobs.job.test.mock");
    // a test call is a real call to the owner's own phone: say how many free minutes it used
    return { ok: true, text: r.data.sent && r.data.minutesUsed > 0 ? `${sent} ${t("jobs.job.test.used", { n: r.data.minutesUsed })}` : sent };
  }

  const mainLines = linesOf(main);
  const moreLines = linesOf(more);
  const lineProps = { byKey, values, t, kind: job.kind, disabled: !canChange, invalid: badKeys, onChange: (k: string, v: string) => void choose(k, v) };

  return (
    <div data-part="job-page" data-job-kind={job.kind} className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <JobHeader
          kind={job.kind}
          plainName={plainName}
          customName={now.customName}
          business={detail.business}
          talks={detail.says.length > 0}
          what={t(`jobs.what.${detail.whatCode}`)}
          status={now.status}
          needsYou={job.needsYou}
          gate={job.planGate}
          enabled={now.enabled}
          ago={ago}
          t={t}
          canChange={canChange}
          busy={busy}
          error={errors.header ?? null}
          onSwitch={(next) => void switchTo(next)}
          onRename={(name) => renameTo(name)}
        />
        {detail.who && detail.says.length ? (
          <WhoTalks
            detail={detail}
            values={values}
            customName={now.customName}
            t={t}
            uiLang={lang}
            setSpeaks={actions?.setSpeaks}
            setValues={setValues}
            onRename={renameTo}
            extra={whoExtra}
          />
        ) : null}
        {detail.failure && job.fix ? <FailureCard failure={detail.failure} fixCount={job.fix.count} t={t} lang={lang} fixHref={`${base}/integrations/whatsapp`} canChange={canChange} /> : null}

        <section data-part="job-when" className={jobCard}>
          <h2 className="m-0 font-display text-[17px] font-bold leading-tight text-ink">{t("jobs.page.when")}</h2>
          <div className="mt-1 flex flex-col">
            {mainLines.map((l) => (
              <SettingLineView key={l.id} line={l} {...lineProps} />
            ))}
          </div>
          {errors.settings ? (
            <p role="alert" className="m-0 mt-2 text-sm text-red-text">
              {errors.settings}
            </p>
          ) : null}
          {effect ? (
            <div data-part="effect" className="mt-3 rounded-xl bg-[var(--jb-info-soft)] px-3.5 py-3 text-[14px] leading-snug text-ink">
              <p className="m-0">
                <b>{t("jobs.job.effect")}</b> {t(`jobs.effect.${job.kind}`, { who: effect.who, t1: fmtMinutes(effect.steps[0].at), t2: fmtMinutes(effect.steps[1].at), t3: fmtMinutes(effect.steps[2].at) })}
              </p>
              <ol className="m-0 mt-3 flex list-none items-start p-0">
                {effect.steps.map((s, i) => (
                  <li key={s.code} className="contents">
                    {i > 0 ? <span aria-hidden="true" className="mt-[5px] h-0.5 min-w-4 flex-[0.7] bg-edge" /> : null}
                    <span className="flex flex-1 flex-col items-center gap-1 text-center text-[13px]">
                      <span aria-hidden="true" className="size-3 rounded-full bg-brand ring-4 ring-brand-bg" />
                      <span className="font-semibold">{fmtMinutes(s.at)}</span>
                      <span className="text-muted">{t(`jobs.step.${s.code}`)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>

        {PART_KEYS.some((k) => detail.unavailable.includes(k)) ? (
          <ul data-part="job-parts-down" role="status" className="m-0 flex list-none flex-col gap-2 p-0">
            {PART_KEYS.filter((k) => detail.unavailable.includes(k)).map((k) => (
              <li key={k} className="rounded-xl bg-[var(--jb-wait-soft)] px-3 py-2.5 text-[14.5px] leading-snug text-ink">
                {t("jobs.job.part.down", { part: t(PART_WORD[k]) })}
              </li>
            ))}
          </ul>
        ) : null}
        {detail.says.length > 0 ? <JobSaysCard says={says} language={detail.who ? undefined : language} values={values} t={t} disabled={!canChange} byKey={byKey} jobName={shownName} base={base} onChange={(k, v) => void choose(k, v)} /> : null}

        <FindsOutCard items={detail.findsOut} enabled={finds} t={t} disabled={!canChange} onChange={(k, on) => void tick(k, on)} />
        {errors.finds ? (
          <p role="alert" className="m-0 text-sm text-red-text">
            {errors.finds}
          </p>
        ) : null}

        <FaqCard faqs={faqs} t={t} disabled={!canChange} error={errors.faqs ?? null} onAdd={addFaq} onRemove={(id) => void removeFaq(id)} />

        {more.length > 0 ? (
          <details data-part="job-more" className={`${jobCard} group`}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block font-display text-[17px] font-bold leading-tight text-ink">{t("jobs.page.more")}</span>
                <span className="block text-sm text-muted">{t("jobs.page.more_sub")}</span>
              </span>
              <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2 flex flex-col">
              {moreLines.map((l) => (
                <SettingLineView key={l.id} line={l} {...lineProps} />
              ))}
            </div>
            <p className="m-0 mt-3 text-sm text-muted">{t("jobs.job.safe")}</p>
            {allSettingsHref ? (
              <p className="m-0 mt-2">
                <a href={allSettingsHref} data-part="all-settings" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline underline-offset-4">
                  {t("jobs.job.all_settings")}
                </a>
              </p>
            ) : null}
          </details>
        ) : allSettingsHref ? (
          <p className="m-0">
            <a href={allSettingsHref} data-part="all-settings" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline underline-offset-4">
              {t("jobs.job.all_settings")}
            </a>
          </p>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
        <ResultsCard results={detail.results} t={t} lang={lang} />
        <p data-part="job-cost" className="m-0 px-1 text-[13.5px] leading-snug text-muted">
          {detail.cost.rupees !== null ? t("jobs.job.cost.rupees", { rupees: groupIndian(detail.cost.rupees) }) : detail.cost.minutesIncluded === null ? t("jobs.job.cost.minutes_only", { used: detail.cost.minutesUsed }) : t("jobs.job.cost.minutes", { used: detail.cost.minutesUsed, included: detail.cost.minutesIncluded })}
        </p>
        {detail.test && detail.says.length > 0 && canChange ? <TryCard channel={detail.test} t={t} onTest={test} /> : null}
        {canChange ? null : <p className="m-0 text-sm text-muted">{t("jobs.job.readonly")}</p>}
      </div>

      {toast ? (
        <div data-part="toast" role="status" className="jb-enter fixed inset-x-4 bottom-24 z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-charcoal px-4 py-3 text-on-charcoal shadow-lg md:bottom-6">
          <span className="min-w-0 text-[15px] font-semibold">{toast.text}</span>
          <button
            type="button"
            onClick={async () => {
              const undo = toast.undo;
              setToast(null);
              await undo();
            }}
            className="jb-press -my-2 -mr-2 min-h-11 shrink-0 px-3 text-[15px] font-bold text-brand-bg"
          >
            {t("jobs.job.undo")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
