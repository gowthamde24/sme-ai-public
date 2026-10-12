"use client";

import { useId, useRef, useState } from "react";

import { makeT, type Words } from "../words";
import type { ImportKind, Inspected, PreviewRow, Previewed, Confirmed, Issue } from "@/lib/api/data";
import { FailureNote } from "../cc/FailureNote";
import { card, h2, h3, help, label as labelClass, muted, okLine, primary, quiet, secondary, selectClass, type Failed, type Reply } from "../cc/kit";
import { postFile } from "../cc/post";
import { chooseColumn, FIELD_WORDS, fileProblem, importSentence, initialChoices, ISSUES, mappingToSend, NOTES, PREVIEW_COUNTS, REASONS, RESULT_COUNTS, SHOWN_ROWS, STATUSES } from "./import-model";
import { dataTable, dataTd, dataThCol, dataTr } from "../ui";

type Source = "tally" | "vyapar" | "sheet";
type Step =
  | { name: "pick" }
  | { name: "map"; file: File; inspected: Inspected; choices: Record<string, string> }
  | { name: "preview"; file: File; inspected: Inspected; choices: Record<string, string>; previewed: Previewed }
  | { name: "done"; confirmed: Confirmed; kind: ImportKind };

const SOURCES: readonly Source[] = ["tally", "vyapar", "sheet"];

/**
 * Settings > Data > "Bring in a spreadsheet" (job CC): pick a file (a Tally or Vyapar export, or any CSV or Excel sheet), see which column is which, see what would happen to every row, then import. The File stays in this
 * page's memory between the steps and is sent as it is each time (the API holds it for one request and never stores it). Nothing is saved before the last button; people and sarees already in the list are never changed.
 * Owner and Admin only; the last step needs the second factor, and a refusal says so and keeps everything.
 */
export function DataImport({ tenantId, words }: { tenantId: string; words: Words }) {
  const t = makeT(words);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source>("sheet");
  const [kind, setKind] = useState<ImportKind>("customers");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>({ name: "pick" });
  const [busy, setBusy] = useState<"check" | "preview" | "import" | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string>(() => crypto.randomUUID());
  const base = `/app/tenants/${tenantId}/data/import`;
  const own = (code: string) => importSentence(code, t);

  const fail = (r: Failed) => setFailure(r);
  const choose = (f: File | null) => {
    setFile(f);
    setFailure(null);
    setNote(f ? fileProblem(f, t) : null);
    setJobId(crypto.randomUUID()); // another file is another job
  };

  async function check() {
    if (!file || note) return;
    setBusy("check");
    setFailure(null);
    const r: Reply<Inspected> = await postFile(`${base}/inspect?kind=${kind}`, file);
    setBusy(null);
    if (!r.ok) return fail(r);
    setStep({ name: "map", file, inspected: r.data, choices: initialChoices(r.data.fields, r.data.suggested_mapping) });
  }

  async function preview(s: Extract<Step, { name: "map" | "preview" }>) {
    const { mapping, missing } = mappingToSend(s.inspected.fields, s.choices);
    if (missing) {
      const f = s.inspected.fields.find((x) => x.field === missing);
      setFailure({ ok: false, kind: "invalid", error: t("dta.map.missing", { label: fieldLabel(missing, f?.label ?? missing) }) });
      return;
    }
    setBusy("preview");
    setFailure(null);
    const r: Reply<Previewed> = await postFile(`${base}/preview?kind=${s.inspected.kind}&job_id=${jobId}&mapping=${encodeURIComponent(JSON.stringify(mapping))}`, s.file);
    setBusy(null);
    if (!r.ok) return fail(r);
    setStep({ name: "preview", file: s.file, inspected: s.inspected, choices: s.choices, previewed: r.data });
  }

  async function run(s: Extract<Step, { name: "preview" }>) {
    setBusy("import");
    setFailure(null);
    const r: Reply<Confirmed> = await postFile(`${base}/confirm?job_id=${s.previewed.job_id}`, s.file);
    setBusy(null);
    if (!r.ok) return fail(r);
    setStep({ name: "done", confirmed: r.data, kind: s.inspected.kind });
  }

  const reset = () => {
    setStep({ name: "pick" });
    setFile(null);
    setNote(null);
    setFailure(null);
    setJobId(crypto.randomUUID());
    if (input.current) input.current.value = "";
  };

  function fieldLabel(fieldName: string, apiLabel: string): string {
    return (FIELD_WORDS as readonly string[]).includes(fieldName) ? t(`dta.field.${fieldName}`) : apiLabel;
  }

  return (
    <section className={card} aria-labelledby={`${id}-h`} data-data="import">
      <h2 id={`${id}-h`} className={h2}>
        {t("dta.import.title")}
      </h2>
      <p className="text-base text-muted">{t("dta.import.intro")}</p>

      {step.name === "pick" ? (
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className={labelClass}>{t("dta.src.label")}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("dta.src.label")}>
              {SOURCES.map((s) => (
                <label key={s} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-base font-semibold ${source === s ? "border-brand-edge bg-brand-bg text-brand-text" : "border-edge bg-surface text-ink"}`}>
                  <input type="radio" name="dta-source" value={s} checked={source === s} onChange={() => setSource(s)} className="size-5 accent-brand-text" />
                  {s === "sheet" ? t("dta.src.sheet") : s === "tally" ? "Tally" : "Vyapar"}
                </label>
              ))}
            </div>
            <p className={help}>{t(`dta.src.tip.${source}`)}</p>
          </fieldset>
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className={labelClass}>{t("dta.kind.label")}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("dta.kind.label")}>
              {(["customers", "stock"] as const).map((k) => (
                <label key={k} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-base font-semibold ${kind === k ? "border-brand-edge bg-brand-bg text-brand-text" : "border-edge bg-surface text-ink"}`}>
                  <input type="radio" name="dta-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="size-5 accent-brand-text" />
                  {t(`dta.kind.${k}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${id}-file`} className={labelClass}>
              {t("dta.file.label")}
            </label>
            <input
              ref={input}
              id={`${id}-file`}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
              aria-describedby={`${id}-limits`}
              className="block min-h-12 w-full rounded-lg border border-edge bg-surface px-3 py-2 text-base file:mr-3 file:min-h-9 file:rounded-full file:border file:border-edge file:bg-surface-2 file:px-4 file:font-semibold"
            />
            <p id={`${id}-limits`} className={help}>
              {file ? `${file.name} (${Math.max(1, Math.round(file.size / 1000))} KB)` : t("dta.file.none")} {t("dta.file.limits")}
            </p>
            {note ? (
              <p role="alert" className="mt-2 text-sm font-medium text-red-text">
                {note}
              </p>
            ) : null}
          </div>
          <FailureNote failure={failure} words={words} own={own} />
          <div>
            <button type="button" onClick={check} disabled={!file || !!note || busy !== null} className={primary}>
              {busy === "check" ? t("dta.btn.checking") : t("dta.btn.check")}
            </button>
          </div>
        </div>
      ) : null}

      {step.name === "map" ? (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className={h3}>{t("dta.map.title")}</h3>
            <p className={muted}>{t("dta.map.help")}</p>
            <p className={muted}>{t("dta.map.rows", { n: step.inspected.rows })}</p>
            {step.inspected.cut_cells > 0 ? <p className={muted}>{t("dta.map.cut", { n: step.inspected.cut_cells })}</p> : null}
            {step.inspected.kind === "customers" ? <p className={muted}>{t("dta.map.phone")}</p> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {step.inspected.fields.map((f) => {
              const chosen = step.choices[f.field] ?? "";
              const col = step.inspected.columns.find((c) => String(c.index) === chosen);
              const guess = col && col.suggested_field === f.field ? col.confidence : null;
              return (
                <div key={f.field}>
                  <label htmlFor={`${id}-f-${f.field}`} className={labelClass}>
                    {fieldLabel(f.field, f.label)}
                    {f.required ? <span className="ml-1 font-normal text-muted">({t("dta.map.needed")})</span> : null}
                  </label>
                  <select id={`${id}-f-${f.field}`} value={chosen} onChange={(e) => setStep({ ...step, choices: chooseColumn(step.choices, f.field, e.target.value) })} className={selectClass}>
                    <option value="">{t("dta.map.notused")}</option>
                    {step.inspected.columns.map((c) => (
                      <option key={c.index} value={String(c.index)}>
                        {c.header.trim() === "" ? `#${c.index + 1}` : c.header}
                      </option>
                    ))}
                  </select>
                  {guess ? <p className={help}>{t(`dta.conf.${guess}`)}</p> : null}
                </div>
              );
            })}
          </div>
          {step.inspected.sample.length > 0 ? (
            <div>
              <h3 className={h3}>{t("dta.map.sample")}</h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      {step.inspected.columns.map((c) => (
                        <th key={c.index} scope="col" className="whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 font-semibold">
                          {c.header.trim() === "" ? `#${c.index + 1}` : c.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {step.inspected.sample.map((row, i) => (
                      <tr key={i}>
                        {step.inspected.columns.map((c) => (
                          <td key={c.index} className="max-w-48 truncate border-b border-line px-3 py-2">
                            {row[c.index] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <FailureNote failure={failure} words={words} own={own} />
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => preview(step)} disabled={busy !== null} className={primary}>
              {busy === "preview" ? t("dta.btn.previewing") : t("dta.btn.preview")}
            </button>
            <button type="button" onClick={reset} disabled={busy !== null} className={quiet}>
              {t("dta.btn.other")}
            </button>
          </div>
        </div>
      ) : null}

      {step.name === "preview" ? (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className={h3}>{t("dta.prev.title")}</h3>
            <p className={muted}>{t("dta.prev.intro")}</p>
          </div>
          <Figures counts={step.previewed.counts} order={PREVIEW_COUNTS[step.inspected.kind]} t={t} />
          <Issues issues={step.previewed.issues} t={t} />
          <RowsTable rows={step.previewed.rows} kind={step.inspected.kind} t={t} />
          <p className={help}>{t("dta.import.mfa")}</p>
          <FailureNote failure={failure} words={words} own={own} />
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => run(step)} disabled={busy !== null || (step.previewed.counts[step.inspected.kind === "customers" ? "will_create" : "will_change"] ?? 0) === 0} className={primary}>
              {busy === "import" ? t("dta.btn.importing") : t("dta.btn.import")}
            </button>
            <button type="button" onClick={() => setStep({ name: "map", file: step.file, inspected: step.inspected, choices: step.choices })} disabled={busy !== null} className={secondary}>
              {t("dta.btn.back")}
            </button>
            <button type="button" onClick={reset} disabled={busy !== null} className={quiet}>
              {t("dta.btn.other")}
            </button>
          </div>
        </div>
      ) : null}

      {step.name === "done" ? (
        <div className="flex flex-col gap-4">
          <p role="status" className={okLine}>
            {t("dta.done.title")}
            {step.confirmed.replay ? ` ${t("dta.done.replay")}` : ""}
          </p>
          {step.confirmed.result ? (
            <>
              <Figures counts={step.confirmed.result.counts} order={RESULT_COUNTS[step.kind]} t={t} />
              <Issues issues={step.confirmed.result.issues} t={t} />
              <RowsTable rows={step.confirmed.result.rows} kind={step.kind} t={t} />
            </>
          ) : null}
          <div>
            <button type="button" onClick={reset} className={secondary}>
              {t("dta.done.again")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Figures({ counts, order, t }: { counts: Record<string, number>; order: readonly string[]; t: ReturnType<typeof makeT> }) {
  const shown = order.filter((k) => k in counts);
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {shown.map((k) => (
        <div key={k} className="rounded-lg bg-surface-2 px-3 py-2">
          <dt className="text-sm text-muted">{t(`dta.status.${k}`)}</dt>
          <dd className="font-display text-xl font-semibold">{counts[k]}</dd>
        </div>
      ))}
    </dl>
  );
}

function Issues({ issues, t }: { issues: Issue[]; t: ReturnType<typeof makeT> }) {
  if (issues.length === 0) return null;
  const shown = issues.slice(0, 10);
  return (
    <div>
      <h3 className={h3}>{t("dta.issues.title")}</h3>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-base">
        {shown.map((i, n) => (
          <li key={n}>{t("dta.issue.line", { line: i.line, text: (ISSUES as readonly string[]).includes(i.code) ? t(`dta.issue.${i.code}`) : t("dta.issue.other") })}</li>
        ))}
      </ul>
      {issues.length > shown.length ? <p className={muted}>{t("dta.issues.more", { n: issues.length - shown.length })}</p> : null}
    </div>
  );
}

function RowsTable({ rows, kind, t }: { rows: PreviewRow[]; kind: ImportKind; t: ReturnType<typeof makeT> }) {
  if (rows.length === 0) return <p className={muted}>{t("dta.rows.none")}</p>;
  const shown = rows.slice(0, SHOWN_ROWS);
  const status = (s: string) => ((STATUSES as readonly string[]).includes(s) ? t(`dta.status.${s}`) : t("dta.reason.other"));
  const stock = (s: string | null) => (s ? t(`catalogue.stock.${s}`) : "");
  return (
    <div>
      <table className={dataTable}>
        <thead>
          <tr>
            <th scope="col" className={dataThCol}>
              {t("dta.col.line")}
            </th>
            <th scope="col" className={dataThCol}>
              {t("dta.col.name")}
            </th>
            <th scope="col" className={dataThCol}>
              {kind === "customers" ? t("dta.col.city") : t("dta.col.change")}
            </th>
            <th scope="col" className={dataThCol}>
              {t("dta.col.result")}
            </th>
            <th scope="col" className={dataThCol}>
              {t("dta.col.note")}
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={`${r.line}-${i}`} className={dataTr}>
              <td data-label={t("dta.col.line")} className={dataTd}>
                {r.line}
              </td>
              <td data-label={t("dta.col.name")} className={`${dataTd} break-words`}>
                {r.label}
              </td>
              <td data-label={kind === "customers" ? t("dta.col.city") : t("dta.col.change")} className={dataTd}>
                {kind === "customers" ? (r.city ?? "") : r.old_status || r.new_status ? `${stock(r.old_status)} → ${stock(r.new_status)}` : ""}
              </td>
              <td data-label={t("dta.col.result")} className={dataTd}>
                {status(r.status)}
              </td>
              <td data-label={t("dta.col.note")} className={dataTd}>
                {r.reason ? ((REASONS as readonly string[]).includes(r.reason) ? t(`dta.reason.${r.reason}`) : t("dta.reason.other")) : r.note ? ((NOTES as readonly string[]).includes(r.note) ? t(`dta.note.${r.note}`) : "") : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? <p className={muted}>{t("dta.rows.shown", { n: shown.length })}</p> : null}
    </div>
  );
}
