"use client";

import { useId, useState } from "react";

import type { ExportFormat } from "@/lib/api/data";
import { FailureNote } from "../cc/FailureNote";
import { card, field, h2, help, label as labelClass, okLine, primary, type Failed } from "../cc/kit";
import { postForFile } from "../cc/post";
import { makeT, type Words } from "../words";
import { fallbackName, lastMonth, rangeProblem } from "./export-model";
import { importSentence } from "./import-model";

/**
 * Settings > Data > "Send your books to your accountant" (job CC): the accounting file for a date range, made by the API (the lists of what you accepted and what was paid) and downloaded to this device. The people who can
 * use it are the Owner and Admin with the second factor; a refusal says so and keeps the choices. The counts the API reports are shown after the download.
 */
export function DataExport({ tenantId, words, formats }: { tenantId: string; words: Words; formats: readonly ExportFormat[] }) {
  const t = makeT(words);
  const id = useId();
  const [format, setFormat] = useState<ExportFormat | "">(formats[0] ?? "");
  const [range, setRange] = useState(() => lastMonth(new Date()));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const problem = rangeProblem(range.from, range.to);

  async function make() {
    if (!format || problem) return;
    setBusy(true);
    setFailure(null);
    setDone(null);
    const r = await postForFile(`/app/tenants/${tenantId}/data/export`, { export_id: crypto.randomUUID(), format, from_date: range.from, to_date: range.to });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.filename ?? fallbackName(format, range.from, range.to);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const sales = r.headers["x-export-sales"];
    const payments = r.headers["x-export-payments"];
    setDone(sales === "0" && payments === "0" ? t("dta.export.empty") : sales !== undefined && payments !== undefined ? t("dta.export.done", { sales, payments }) : t("dta.export.done_plain"));
  }

  return (
    <section className={card} aria-labelledby={`${id}-h`} data-data="export">
      <h2 id={`${id}-h`} className={h2}>
        {t("dta.export.title")}
      </h2>
      <p className="text-base text-muted">{t("dta.export.intro")}</p>
      {formats.length === 0 ? (
        <p className="text-base text-muted">{t("dta.export.no_formats")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1 border-0 p-0">
            <legend className={labelClass}>{t("dta.export.format")}</legend>
            {formats.map((f) => (
              <label key={f} className="flex min-h-11 items-center gap-3 text-base">
                <input type="radio" name={`${id}-format`} value={f} checked={format === f} onChange={() => setFormat(f)} className="size-5 shrink-0 accent-brand-text" />
                {t(`dta.fmt.${f}`)}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-from`} className={labelClass}>
                {t("dta.export.from")}
              </label>
              <input id={`${id}-from`} type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange({ ...range, from: e.target.value })} className={field} />
            </div>
            <div>
              <label htmlFor={`${id}-to`} className={labelClass}>
                {t("dta.export.to")}
              </label>
              <input id={`${id}-to`} type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} className={field} />
            </div>
          </div>
          <p className={help}>{t("dta.export.range")}</p>
          {problem === "order" ? (
            <p role="alert" className="text-sm font-medium text-red-text">
              {t("dta.export.range_bad")}
            </p>
          ) : null}
          {format.startsWith("tally") ? <p className={help}>{t("dta.export.tip")}</p> : null}
          <p className={help}>{t("dta.export.mfa")}</p>
          <FailureNote failure={failure} words={words} own={(code) => importSentence(code, t)} />
          {done ? (
            <p role="status" className={okLine}>
              {done}
            </p>
          ) : null}
          <div>
            <button type="button" onClick={make} disabled={busy || !!problem || !format} className={primary}>
              {busy ? t("dta.btn.exporting") : t("dta.btn.export")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
