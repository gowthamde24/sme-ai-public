"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import { FAQ_A_MAX, FAQ_MAX, FAQ_Q_MAX, checkFaq, type JobFaq, type JobFindsOut } from "@/lib/jobs/detail";

import { Tick } from "../../ds/Tick";
import type { Say } from "../../words";
import { jobBtnMain, jobBtnQuiet, jobCard, jobH2 } from "./types";

/** "What it finds out": a round tick per thing the assistant asks about, saved when it is ticked. */
export function FindsOutCard({ items, enabled, t, disabled, onChange }: { items: readonly JobFindsOut[]; enabled: Readonly<Record<string, boolean>>; t: Say; disabled: boolean; onChange: (key: string, on: boolean) => void }) {
  if (items.length === 0) return null;
  return (
    <section data-part="job-finds" className={jobCard}>
      <h2 className={jobH2}>{t("jobs.page.finds")}</h2>
      <div className="mt-1.5 flex flex-col">
        {items.map((f) => (
          <Tick key={f.key} data-finds={f.key} label={t(`jobs.finds.${f.key}`)} checked={enabled[f.key] ?? f.enabled} disabled={disabled} onChange={(e) => onChange(f.key, e.target.checked)} />
        ))}
      </div>
    </section>
  );
}

const input = "min-h-12 w-full rounded-xl border border-edge bg-surface px-3 text-[16px] text-ink focus:border-brand-edge";

/** "FAQs it can answer": the questions customers ask most and the answers the assistant gives; add by typing, remove with the cross. */
export function FaqCard({ faqs, t, disabled, error, onAdd, onRemove }: { faqs: readonly JobFaq[]; t: Say; disabled: boolean; error: string | null; onAdd: (q: string, a: string) => Promise<boolean>; onRemove: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const full = faqs.length >= FAQ_MAX;

  async function add() {
    if (!checkFaq(q, a).ok) {
      setBad(true);
      return;
    }
    setBusy(true);
    const ok = await onAdd(q, a);
    setBusy(false);
    if (ok) {
      setQ("");
      setA("");
      setAdding(false);
      setBad(false);
    }
  }

  return (
    <section data-part="job-faqs" className={jobCard}>
      <h2 className={jobH2}>{t("jobs.page.faqs")}</h2>
      <p className="m-0 mt-1 text-sm text-muted">{t("jobs.job.faq.help")}</p>
      {faqs.length === 0 ? (
        <p data-empty="faqs" className="m-0 mt-3 text-[15px] text-muted">
          {t("jobs.job.faq.none")}
        </p>
      ) : (
        <ul className="m-0 mt-2 list-none p-0">
          {faqs.map((f) => (
            <li key={f.id} data-faq={f.id} className="flex items-start gap-2 border-b border-line py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[15px] font-semibold text-ink">{f.question}</p>
                <p className="m-0 text-sm leading-snug text-muted">{f.answer}</p>
              </div>
              {disabled ? null : (
                <button type="button" aria-label={t("jobs.job.faq.remove", { q: f.question })} onClick={() => onRemove(f.id)} className="jb-press write-ctl -my-1 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted">
                  <X aria-hidden="true" className="size-[18px]" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {disabled ? null : adding ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">{t("jobs.job.faq.q")}</span>
            <input value={q} maxLength={FAQ_Q_MAX} onChange={(e) => setQ(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">{t("jobs.job.faq.a")}</span>
            <textarea value={a} maxLength={FAQ_A_MAX} rows={3} onChange={(e) => setA(e.target.value)} className={`${input} py-2`} />
          </label>
          {bad ? (
            <p role="alert" className="m-0 text-sm text-red-text">
              {t("jobs.job.faq.bad")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={jobBtnMain}>
              {t("jobs.job.faq.add")}
            </button>
            <button type="button" disabled={busy} onClick={() => setAdding(false)} className={jobBtnQuiet}>
              {t("jobs.job.faq.cancel")}
            </button>
          </div>
        </form>
      ) : full ? (
        <p className="m-0 mt-3 text-sm text-muted">{t("jobs.job.faq.max", { n: FAQ_MAX })}</p>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${jobBtnQuiet} mt-3`}>
          <Plus aria-hidden="true" className="size-4" />
          {t("jobs.job.faq.new")}
        </button>
      )}
      {error ? (
        <p role="alert" className="m-0 mt-2 text-sm text-red-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
