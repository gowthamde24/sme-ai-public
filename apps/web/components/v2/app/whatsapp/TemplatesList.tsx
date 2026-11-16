"use client";

import * as React from "react";

import type { Template } from "@/lib/api/whatsapp";

import { FailureNote } from "../cc/FailureNote";
import { card, h2, pillClass, type Failed } from "../cc/kit";
import { dataTable, dataTd, dataThCol, dataTr } from "../ui";
import { makeT, type Words } from "../words";
import { waSentence } from "./wa-model";
import type { TemplateActions } from "./wa-types";

const btn = "inline-flex min-h-11 items-center justify-center rounded-[9px] border border-line bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";
const btnPrimary = "inline-flex min-h-11 items-center justify-center rounded-[9px] bg-brand px-3.5 text-sm font-bold text-on-brand disabled:opacity-60";

/**
 * The message templates (job CC, screen 5): a template is what may be sent to a customer whose 24 hours are over, and only an approved one is ever used. The Owner and an Admin can send the drafts to WhatsApp for review (all of them, after a question that names how many, or one row at a time) and ask what WhatsApp answered; each answer redraws the status pills from the templates the API returns. Sending needs the second factor, which the API asks: a refusal says so and links to Security. Nothing is sent to a customer from here. A Sales member only reads.
 */
export function TemplatesList({ words, items: initial, actions = null }: { words: Words; items: Template[]; /** null = read only (no buttons) */ actions?: TemplateActions | null }) {
  const t = makeT(words);
  const [items, setItems] = React.useState(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [failure, setFailure] = React.useState<Failed | null>(null);
  const [said, setSaid] = React.useState<string | null>(null);
  React.useEffect(() => setItems(initial), [initial]);
  const tone = { draft: "neutral", submitted: "amber", approved: "green", rejected: "red", paused: "amber", disabled: "red" } as const;
  const drafts = items.filter((x) => x.status === "draft");

  const merge = (changed: readonly Template[], replaceAll: boolean) => setItems((cur) => (replaceAll ? [...changed] : cur.map((x) => changed.find((c) => c.id === x.id) ?? x)));
  async function go(what: string, work: () => ReturnType<TemplateActions["sync"]>, after: (r: { submitted?: number; refused?: number; changed?: number }) => string, all: boolean) {
    setBusy(what);
    setFailure(null);
    setSaid(null);
    const r = await work().catch((): Failed => ({ ok: false, kind: "unavailable", error: t("today.err.generic") }));
    setBusy(null);
    if (!r.ok) return setFailure(r);
    merge(r.data.templates, all);
    setSaid(after(r.data));
  }
  const sentAll = (r: { submitted?: number; refused?: number }) => [t("wa.tpl.done.submitted", { n: r.submitted ?? 0 }), (r.refused ?? 0) > 0 ? t("wa.tpl.done.refused", { n: r.refused ?? 0 }) : null].filter(Boolean).join(" ");

  return (
    <section className={card} aria-labelledby="wa-templates-h" data-whatsapp="templates">
      <h2 id="wa-templates-h" className={h2}>
        {t("wa.tpl.title")}
      </h2>
      <p className="text-base text-muted">{t("wa.tpl.intro")}</p>
      {actions ? (
        <div className="mb-3 flex flex-wrap items-center gap-2" data-part="template-tools">
          <button type="button" className={btn} disabled={busy !== null || drafts.length === 0} onClick={() => setAsking(true)} data-part="send-drafts">
            {t("wa.tpl.send_all")}
          </button>
          <button type="button" className={btn} disabled={busy !== null} onClick={() => void go("sync", actions.sync, (r) => ((r.changed ?? 0) > 0 ? t("wa.tpl.done.sync", { n: r.changed ?? 0 }) : t("wa.tpl.done.nochange")), true)} data-part="sync-templates">
            {busy === "sync" ? t("dta.btn.working") : t("wa.tpl.sync")}
          </button>
        </div>
      ) : null}
      {actions && asking ? (
        <div role="group" aria-label={t("wa.tpl.send_all")} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 p-3" data-part="send-drafts-confirm">
          <p className="m-0 text-base font-medium text-ink">{t(drafts.length === 1 ? "wa.tpl.send_all.confirm.one" : "wa.tpl.send_all.confirm.other", { n: drafts.length })}</p>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy !== null || drafts.length === 0}
            onClick={() => {
              setAsking(false);
              void go("all", actions.submitDrafts, sentAll, true);
            }}
          >
            {t("wa.tpl.send_one")}
          </button>
          <button type="button" className={btn} onClick={() => setAsking(false)}>
            {t("wa.tpl.cancel")}
          </button>
        </div>
      ) : null}
      <FailureNote failure={failure} words={words} own={(code) => waSentence(code, t)} />
      {said ? (
        <p role="status" className="m-0 mb-2 text-base font-medium text-green-text" data-part="template-said">
          {said}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-base text-muted">{t("wa.tpl.none")}</p>
      ) : (
        <table className={dataTable}>
          <thead>
            <tr>
              {["wa.tpl.col.name", "wa.tpl.col.language", "wa.tpl.col.purpose", "wa.tpl.col.status"].map((k) => (
                <th key={k} scope="col" className={dataThCol}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id} className={dataTr}>
                <td data-label={t("wa.tpl.col.name")} className={`${dataTd} break-words font-mono text-sm`}>
                  {x.name}
                  {x.optOutLabel ? <span className="mt-1 block font-sans text-xs text-muted">{t("wa.tpl.optout", { label: x.optOutLabel })}</span> : null}
                </td>
                <td data-label={t("wa.tpl.col.language")} className={dataTd}>
                  {t(`today.lang.${x.language}`)}
                </td>
                <td data-label={t("wa.tpl.col.purpose")} className={dataTd}>
                  {["followup", "visit", "order_status", "info"].includes(x.purpose) ? t(`wa.tpl.purpose.${x.purpose}`) : x.purpose}
                </td>
                <td data-label={t("wa.tpl.col.status")} className={dataTd}>
                  <span className={pillClass(tone[x.status])}>{t(`wa.tpl.status.${x.status}`)}</span>
                  {actions && x.status === "draft" ? (
                    <button type="button" className={`${btn} ml-2`} disabled={busy !== null} onClick={() => void go(x.id, () => actions.submitOne(x.id), () => t("wa.tpl.done.one"), false)} data-part="send-one">
                      {busy === x.id ? t("dta.btn.working") : t("wa.tpl.send_one")}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
