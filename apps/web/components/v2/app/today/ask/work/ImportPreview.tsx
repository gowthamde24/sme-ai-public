"use client";

import { FileSpreadsheet, Trash2 } from "lucide-react";
import * as React from "react";

import type { ImportError } from "@/lib/assistant-work/client";
import type { ConsentSource, Destination, FilePreviewCard, ImportDraft, ImportRow, WorkPlan } from "@/lib/assistant-work/types";

import { PlanView } from "./PlanView";
import { btnDo, btnSmall, cardBox, type WorkEnv } from "./work-env";

const PROBLEM: Readonly<Record<ImportError, string>> = {
  state: "bv.work.imp.err.state",
  consent: "bv.work.imp.err.consent",
  invalid: "bv.work.imp.err.invalid",
  gone: "bv.work.imp.err.gone",
  forbidden: "bv.work.imp.err.forbidden",
  down: "bv.work.imp.err.down",
};

const cellBox = "block min-h-11 w-full min-w-0 rounded-lg border px-2 text-sm text-ink";

/**
 * The editable preview of a file the assistant read (owner, 14 Nov; contract docs/contracts/file-import.md): every cell can be corrected, cells the reader was unsure of are highlighted, a row can be left out, and for people the owner says where they
 * come from (the consent source: nobody is called or messaged without one). Nothing is written before "Add N": that button asks the API for the plan, and the plan's own Do it adds them (Undo archives what was added). The original stays 90 days,
 * private to the business, and can be deleted here at once. SERVER-SENT TEXT IS UNTRUSTED: every cell is plain text in a plain input.
 */
export function ImportPreview({ card, draft: first, env }: { card: FilePreviewCard; draft: ImportDraft; env: WorkEnv }) {
  const { t, transport } = env;
  const [draft, setDraft] = React.useState<ImportDraft>(first);
  const [consent, setConsent] = React.useState<ConsentSource | null>(first.consent?.chosen ?? null);
  const [busy, setBusy] = React.useState<null | "edit" | "confirm" | "more" | "delete" | "destination">(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [plan, setPlan] = React.useState<WorkPlan | null>(card.plan);
  const [deleted, setDeleted] = React.useState(false);
  const uid = React.useId();

  const fail = (error: ImportError) => setProblem(t(PROBLEM[error]));
  const locked = plan !== null || deleted || draft.state !== "ready";
  const included = draft.rows.filter((r) => r.include).length;
  const needsConsent = draft.consent?.required === true && consent === null;

  /** After a change the API revalidated (phones, duplicates): the first page is read again and merged by row id, so the pages already loaded keep their place. */
  const refresh = async () => {
    const got = await transport.importGet(draft.importId, null);
    if (!got.ok) return fail(got.error);
    setDraft((d) => {
      const fresh = new Map(got.draft.rows.map((r) => [r.rowId, r]));
      return { ...d, counts: got.draft.counts, rows: d.rows.map((r) => fresh.get(r.rowId) ?? r) };
    });
  };

  const send = async (change: { edits: { rowId: string; cell: string; value: string }[]; include: { rowId: string; include: boolean }[] }) => {
    setBusy("edit");
    setProblem(null);
    const out = await transport.importEdit(draft.importId, change);
    if (!out.ok) {
      setBusy(null);
      return fail(out.error);
    }
    setDraft((d) => ({ ...d, counts: out.counts }));
    await refresh();
    setBusy(null);
  };

  const onBlur = (row: ImportRow, key: string, value: string) => {
    if (locked || value === row.cells[key]?.value) return;
    void send({ edits: [{ rowId: row.rowId, cell: key, value }], include: [] });
  };
  const toggle = (row: ImportRow, on: boolean) => {
    setDraft((d) => ({ ...d, rows: d.rows.map((r) => (r.rowId === row.rowId ? { ...r, include: on } : r)) }));
    void send({ edits: [], include: [{ rowId: row.rowId, include: on }] });
  };

  const goTo = async (destination: Destination) => {
    if (locked || destination === draft.destination) return;
    setBusy("destination");
    setProblem(null);
    const out = await transport.importDestination(draft.importId, destination);
    setBusy(null);
    if (!out.ok) return fail(out.error);
    setDraft(out.draft);
    setConsent(out.draft.consent?.chosen ?? null);
  };

  const more = async () => {
    if (!draft.nextCursor) return;
    setBusy("more");
    const got = await transport.importGet(draft.importId, draft.nextCursor);
    setBusy(null);
    if (!got.ok) return fail(got.error);
    setDraft((d) => ({ ...d, nextCursor: got.draft.nextCursor, rows: [...d.rows, ...got.draft.rows.filter((r) => !d.rows.some((x) => x.rowId === r.rowId))] }));
  };

  const confirm = async () => {
    if (needsConsent || included === 0) return;
    setBusy("confirm");
    setProblem(null);
    const out = await transport.importConfirm(draft.importId, consent, []);
    setBusy(null);
    if (!out.ok) return fail(out.error);
    setPlan(out.plan);
  };

  const remove = async () => {
    setBusy("delete");
    const out = await transport.importCancel(draft.importId);
    setBusy(null);
    if (!out.ok) return fail(out.error);
    setDeleted(true);
  };

  if (deleted) {
    return (
      <article data-work="preview" data-import="deleted" className={cardBox}>
        <p className="text-sm font-semibold">{t("bv.work.imp.deleted")}</p>
      </article>
    );
  }

  const c = draft.counts;
  const facts = [
    t("bv.work.imp.count.rows", { n: c.rows }),
    c.existing > 0 ? t("bv.work.imp.count.existing", { n: c.existing }) : null,
    c.invalidPhone > 0 ? t("bv.work.imp.count.invalid", { n: c.invalidPhone }) : null,
    c.unsure > 0 ? t("bv.work.imp.count.unsure", { n: c.unsure }) : null,
  ].filter((x): x is string => x !== null);
  const where = t(`bv.work.pv.dest.${draft.destination}`);

  return (
    <article data-work="preview" data-import="editable" data-destination={draft.destination} aria-label={t("bv.work.pv.title", { name: card.fileName })} className={cardBox}>
      <h3 className="flex items-start gap-2 text-base font-semibold [overflow-wrap:anywhere]">
        <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-brand-text" aria-hidden="true" />
        <span>{t("bv.work.pv.title", { name: card.fileName })}</span>
      </h3>
      <p data-work="facts" className="mt-1 text-sm font-semibold">
        {facts.join(" · ")}
      </p>
      {card.readBy !== "file" ? (
        <p data-work="read-by" data-read-by={card.readBy} className="mt-1 text-sm font-semibold text-amber-text">
          {card.readBy === "ai_handwriting" ? t("bv.work.imp.handwriting") : t("bv.work.pv.picture")}
        </p>
      ) : null}
      {c.unsure > 0 && !locked ? <p className="mt-1 text-sm text-amber-text">{t("bv.work.imp.unsure")}</p> : null}

      <ul data-work="import-rows" className="mt-2 flex flex-col gap-2">
        {draft.rows.map((row, i) => (
          <li key={row.rowId} data-row={row.rowId} data-included={row.include ? "true" : "false"} className={`rounded-xl border p-2 ${row.include ? "border-line bg-surface-2" : "border-line bg-surface opacity-70"}`}>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" data-row-include="" checked={row.include} disabled={locked} onChange={(e) => toggle(row, e.target.checked)} className="size-5" />
              {t("bv.work.imp.include", { n: i + 1 })}
            </label>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {draft.columns.map((col) => {
                const cell = row.cells[col.key];
                const unsure = cell?.unsure === true;
                const bad = col.key === "phone" && (row.invalidPhone || cell?.valid === false);
                return (
                  <label key={col.key} className="flex min-w-0 flex-col gap-0.5 text-xs font-semibold text-muted">
                    {col.label}
                    <input
                      type="text"
                      data-cell={col.key}
                      data-unsure={unsure ? "true" : undefined}
                      defaultValue={cell?.value ?? ""}
                      key={`${row.rowId}-${col.key}-${cell?.value ?? ""}-${unsure}`}
                      disabled={locked}
                      maxLength={200}
                      aria-label={t("bv.work.imp.edit", { column: col.label, n: i + 1 })}
                      aria-invalid={bad ? true : undefined}
                      onBlur={(e) => onBlur(row, col.key, e.currentTarget.value)}
                      className={`${cellBox} ${bad ? "border-red-text" : unsure ? "border-amber-text bg-amber-bg" : "border-line bg-surface"}`}
                    />
                    {unsure ? <span className="text-amber-text">{t("bv.work.imp.check")}</span> : null}
                  </label>
                );
              })}
            </div>
            {row.duplicateOf !== null ? <p className="mt-1 text-xs font-semibold text-muted">{t("bv.work.imp.dup", { name: row.duplicateOf })}</p> : null}
            {row.invalidPhone ? <p className="mt-1 text-xs font-semibold text-red-text">{t("bv.work.imp.badphone")}</p> : null}
            {row.missingRequired ? <p className="mt-1 text-xs font-semibold text-red-text">{t("bv.work.imp.missing")}</p> : null}
          </li>
        ))}
      </ul>
      {draft.nextCursor && !locked ? (
        <button type="button" data-import="more" disabled={busy !== null} onClick={() => void more()} className={`${btnSmall} mt-2`}>
          {t("bv.work.imp.more")}
        </button>
      ) : null}

      {draft.destinations && draft.destinations.length > 1 ? (
        <div data-import="destinations" role="group" aria-label={t("bv.work.imp.dest.title")} className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{t("bv.work.imp.dest.title")}</span>
          {draft.destinations.map((d) => (
            <button key={d} type="button" data-destination-choice={d} aria-pressed={d === draft.destination} disabled={locked || busy !== null} onClick={() => void goTo(d)} className={`${btnSmall} ${d === draft.destination ? "!border-brand-edge !bg-brand-bg !text-brand-text" : ""}`}>
              {t(`bv.work.imp.dest.${d}`)}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm">
          <span className="font-semibold">{t("bv.work.pv.goes")}</span> {where}
        </p>
      )}

      {draft.consent?.required ? (
        <fieldset data-import="consent" disabled={locked} className="mt-2 min-w-0 rounded-xl border border-line p-2">
          <legend className="px-1 text-sm font-semibold">{t("bv.work.imp.consent.title")}</legend>
          {draft.consent.options.map((o) => (
            <label key={o} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name={`${uid}-consent`} value={o} checked={consent === o} onChange={() => setConsent(o)} className="size-5" />
              {t(`bv.work.imp.consent.${o}`)}
            </label>
          ))}
          <p className="px-1 text-xs text-muted">{t("bv.work.imp.consent.note")}</p>
        </fieldset>
      ) : null}

      {problem ? (
        <p role="alert" data-import="problem" className="mt-2 text-sm font-semibold text-red-text">
          {problem}
        </p>
      ) : null}

      {!locked ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" data-import="add" disabled={busy !== null || needsConsent || included === 0} onClick={() => void confirm()} className={btnDo}>
            {busy === "confirm" ? t("bv.work.imp.saving") : t(draft.destination === "leads" ? "bv.work.imp.add.leads" : draft.destination === "prices" ? "bv.work.imp.add.prices" : "bv.work.imp.add.rows", { n: included })}
          </button>
          <button type="button" data-import="delete" disabled={busy !== null} onClick={() => void remove()} className={`${btnSmall} gap-1.5`}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t("bv.work.imp.delete")}
          </button>
        </div>
      ) : null}
      {needsConsent && !locked ? <p className="mt-1 text-xs text-muted">{t("bv.work.imp.err.consent")}</p> : null}
      {included === 0 && !locked ? <p className="mt-1 text-xs text-muted">{t("bv.work.imp.none")}</p> : null}
      <p className="mt-2 text-xs text-muted">{t("bv.work.imp.keep")}</p>

      {plan ? (
        <div className="mt-3 border-t border-line pt-3">
          <PlanView plan={plan} env={env} />
        </div>
      ) : null}
    </article>
  );
}
