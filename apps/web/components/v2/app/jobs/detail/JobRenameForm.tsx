"use client";

import { useState } from "react";

import { JOB_NAME_MAX, checkJobName } from "@/lib/jobs/detail";

import type { Say } from "../../words";
import { jobBtnMain, jobBtnQuiet } from "./types";

/** The inline rename form on the top card of a job's page; only shown and loaded when the owner taps the name or pencil to edit. */
export function JobRenameForm({
  plainName,
  customName,
  business,
  talks,
  t,
  onRename,
  onClose,
}: {
  plainName: string;
  customName: string | null;
  business: string;
  talks: boolean;
  t: Say;
  onRename: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(customName ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const checked = checkJobName(draft);
  const typed = checked.ok ? checked.name : draft.trim();

  async function save(raw: string) {
    const c = checkJobName(raw);
    if (!c.ok) {
      setNameError(t(c.why === "long" ? "jobs.job.name.long" : "jobs.job.name.chars"));
      return;
    }
    setSaving(true);
    const ok = await onRename(c.name ?? "");
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <form
      data-part="rename"
      className="mt-3 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save(draft);
      }}
    >
      <h1 className="m-0 font-display text-[22px] font-bold leading-tight text-ink">{plainName}</h1>
      <label className="flex flex-col gap-1.5">
        <span className="text-[15px] text-muted">{t("jobs.job.name.label")}</span>
        <input
          autoFocus
          value={draft}
          maxLength={JOB_NAME_MAX}
          onChange={(e) => {
            setDraft(e.target.value);
            setNameError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          className="min-h-12 w-full rounded-xl border-2 border-brand-edge bg-surface px-3 text-[17px] text-ink"
        />
      </label>
      {talks ? (
        <p data-part="hear" aria-live="polite" className="m-0 text-[15px] text-muted">
          {typed ? t("jobs.job.name.hear", { name: typed, business }) : t("jobs.job.name.hear_plain", { business })}
        </p>
      ) : null}
      {nameError ? (
        <p role="alert" className="m-0 text-sm text-red-text">
          {nameError}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className={jobBtnMain}>
          {t("jobs.job.name.save")}
        </button>
        <button type="button" disabled={saving} onClick={() => void save("")} className={jobBtnQuiet}>
          {t("jobs.job.name.plain")}
        </button>
      </div>
    </form>
  );
}
