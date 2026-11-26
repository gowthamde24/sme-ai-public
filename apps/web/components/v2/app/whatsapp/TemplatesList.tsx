"use client";

import * as React from "react";

import type { FailedTemplate, RenamedTemplate, Template } from "@/lib/api/whatsapp";

import { FailureNote } from "../cc/FailureNote";
import { card, h2, pillClass, type Failed } from "../cc/kit";
import { dataThCol } from "../ui";
import { makeT, type Words } from "../words";
import { waSentence } from "./wa-model";
import type { TemplateActions } from "./wa-types";
import { cardBox } from "../Card";

const btn = "inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";
const btnPrimary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-3.5 text-sm font-bold text-on-brand disabled:opacity-60";

/**
 * The message templates (job CC, screen 5): a template is what may be sent to a customer whose 24 hours are over, and only an approved one is ever used. The Owner and an Admin can send the drafts to WhatsApp for review (all of them, after a question that names how many, or one row at a time) and ask what WhatsApp answered; each answer redraws the status pills from the templates the API returns. Sending needs the second factor, which the API asks: a refusal says so and links to Security. Nothing is sent to a customer from here. A Sales member only reads.
 */
export function TemplatesList({ words, items: initial, actions = null, plain = false, bare = false }: { /** TEMPLATES_PLAIN: plain rows instead of the table. */ plain?: boolean; /** drawn inside a box that is already there (no box of its own) */ bare?: boolean; words: Words; items: Template[]; /** null = read only (no buttons) */ actions?: TemplateActions | null }) {
  const t = makeT(words);
  // the rows are the page's until an answer from the API replaces them; a new page read (initial changes) wins again
  const [own, setOwn] = React.useState<{ from: Template[]; rows: Template[] }>({ from: initial, rows: initial });
  const items = own.from === initial ? own.rows : initial;
  const setItems = (next: (cur: Template[]) => Template[]) => setOwn({ from: initial, rows: next(items) });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [failure, setFailure] = React.useState<Failed | null>(null);
  const [said, setSaid] = React.useState<string | null>(null);
  const [notAccepted, setNotAccepted] = React.useState<readonly FailedTemplate[]>([]);
  const tone = { draft: "neutral", submitted: "amber", approved: "green", rejected: "red", paused: "amber", disabled: "red" } as const;
  const drafts = items.filter((x) => x.status === "draft");

  const merge = (changed: readonly Template[], replaceAll: boolean) => setItems((cur) => (replaceAll ? [...changed] : cur.map((x) => changed.find((c) => c.id === x.id) ?? x)));
  async function go(what: string, work: () => ReturnType<TemplateActions["sync"]>, after: (r: { submitted?: number; refused?: number; changed?: number }) => string, all: boolean) {
    setBusy(what);
    setFailure(null);
    setSaid(null);
    setNotAccepted([]);
    const r = await work().catch((): Failed => ({ ok: false, kind: "unavailable", error: t("today.err.generic") }));
    setBusy(null);
    if (!r.ok) return setFailure(r);
    merge(r.data.templates, all);
    setNotAccepted(r.data.failed ?? []);
    setSaid(after(r.data));
  }
  // never silent: how many went, and every draft WhatsApp did not take with its reason (an API from before the list sends only the count)
  const sentAll = (r: { submitted?: number; refused?: number; failed?: FailedTemplate[]; renamed?: RenamedTemplate[] }) =>
    [
      t("wa.tpl.done.submitted", { n: r.submitted ?? 0 }),
      // the same sentence says which drafts went under a new name: "2 renamed: visit_reminder Telugu is now visit_reminder_v2; ..."
      (r.renamed?.length ?? 0) > 0 ? `${t("wa.tpl.done.renamed", { n: r.renamed?.length ?? 0 })} ${(r.renamed ?? []).map((x) => t("wa.tpl.done.renamed.line", { name: x.name, language: words[`today.lang.${x.language}`] ?? x.language, meta: x.metaName })).join("; ")}.` : null,
      (r.failed?.length ?? 0) === 0 && (r.refused ?? 0) > 0 ? t("wa.tpl.done.refused", { n: r.refused ?? 0 }) : null,
    ]
      .filter(Boolean)
      .join(" ");

  if (plain) {
    // one row per message (all its languages together), its ONE status in words: the least finished language decides
    const order = ["rejected", "paused", "disabled", "draft", "submitted", "approved"] as const;
    const groups = new Map<string, Template[]>();
    for (const x of items) groups.set(x.name.replace(/_v\d+$/, ""), [...(groups.get(x.name.replace(/_v\d+$/, "")) ?? []), x]);
    const plainName = (n: string) => (words[`wa.tpl.plain.${n}`] ? t(`wa.tpl.plain.${n}`) : (n.replace(/_/g, " ").charAt(0).toUpperCase() + n.replace(/_/g, " ").slice(1)));
    return (
      <section data-whatsapp="templates" data-plain="" aria-label={t("wa.tpl.title")} className={bare ? "flex flex-col gap-3" : `${cardBox} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="m-0 min-w-0 flex-1 text-[15px] text-muted">{t("wa.tpl.plain.note")}</p>
          {actions ? (
            <button type="button" className={btnPrimary} disabled={busy !== null || drafts.length === 0} onClick={() => setAsking(true)} data-part="send-drafts">
              {t("wa.tpl.plain.send_all")}
            </button>
          ) : null}
        </div>
        {actions && asking ? (
          <div role="group" aria-label={t("wa.tpl.plain.send_all")} className="flex flex-wrap items-center gap-3 border-y border-line py-3" data-part="send-drafts-confirm">
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
            <button type="button" className="text-[15px] font-semibold text-muted underline underline-offset-4" onClick={() => setAsking(false)}>
              {t("wa.tpl.cancel")}
            </button>
          </div>
        ) : null}
        <FailureNote failure={failure} words={words} own={(code) => (code === "whatsapp_refused" && failure?.error ? failure.error : waSentence(code, t))} />
        {said ? (
          <p role="status" className="m-0 text-base font-medium text-ink" data-part="template-said">
            {said}
          </p>
        ) : null}
        {notAccepted.length > 0 ? (
          <ul role="status" className="m-0 flex list-none flex-col gap-1 p-0 text-[15px] text-ink" data-part="templates-not-accepted">
            {notAccepted.map((f) => (
              <li key={f.id} data-part="not-accepted-row">
                {`${plainName(f.name.replace(/_v\d+$/, ""))} · ${words[`today.lang.${f.language}`] ?? f.language}: ${f.reason}`}
              </li>
            ))}
          </ul>
        ) : null}
        {items.length === 0 ? (
          <p className="m-0 text-base text-muted">{t("wa.tpl.none")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col border-t border-line p-0">
            {[...groups.entries()].map(([name, rows]) => {
              const status = order.find((o) => rows.some((r) => r.status === o)) ?? "approved";
              const key = status === "paused" || status === "disabled" ? "rejected" : status;
              return (
                <li key={name} data-tpl={name} data-tstate={status} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-4">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[17px] font-semibold text-ink">{plainName(name)}</p>
                    <p className="m-0 text-[15px] text-muted">{[...new Set(rows.map((r) => t(`today.lang.${r.language}`)))].join(" · ")}</p>
                  </div>
                  <span className={`shrink-0 text-[15px] ${status === "draft" ? "text-muted" : status === "approved" ? "text-ink" : "font-semibold text-brand-text"}`}>{t(`wa.tpl.plain.${key}`)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {actions ? (
          <p className="m-0">
            <button type="button" className="text-[15px] font-semibold text-muted underline underline-offset-4" disabled={busy !== null} onClick={() => void go("sync", actions.sync, (r) => ((r.changed ?? 0) > 0 ? t("wa.tpl.done.sync", { n: r.changed ?? 0 }) : t("wa.tpl.done.nochange")), true)}>
              {busy === "sync" ? t("dta.btn.working") : t("wa.tpl.sync")}
            </button>
          </p>
        ) : null}
      </section>
    );
  }
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
      <FailureNote failure={failure} words={words} own={(code) => (code === "whatsapp_refused" && failure?.error ? failure.error : waSentence(code, t))} />
      {said ? (
        <p role="status" className="m-0 mb-2 text-base font-medium text-green-text" data-part="template-said">
          {said}
        </p>
      ) : null}
      {notAccepted.length > 0 ? (
        <div role="status" className="mb-3 rounded-xl border border-red-text bg-red-bg p-3" data-part="templates-not-accepted">
          <p className="m-0 text-base font-semibold text-red-text">{t(notAccepted.length === 1 ? "wa.tpl.done.notaccepted.one" : "wa.tpl.done.notaccepted.other", { n: notAccepted.length })}</p>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-sm text-ink">
            {notAccepted.map((f) => (
              <li key={f.id} data-part="not-accepted-row">
                {`${f.name} ${words[`today.lang.${f.language}`] ?? f.language}: ${f.reason}`}
                {f.metaMessage ? ` ${t("wa.tpl.failed.meta", { meta: f.metaMessage })}` : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="text-base text-muted">{t("wa.tpl.none")}</p>
      ) : (
        <table className="w-full border-collapse text-left text-base max-sm:block max-sm:[&_thead]:sr-only max-sm:[&>tbody]:flex max-sm:[&>tbody]:flex-col max-sm:[&>tbody]:gap-2.5">
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
              <tr key={x.id} className="border-b border-line max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-start max-sm:gap-x-3 max-sm:gap-y-1 max-sm:rounded-xl max-sm:border max-sm:border-line max-sm:bg-surface-2/40 max-sm:p-3">
                <td data-label={t("wa.tpl.col.name")} className="px-3 py-2 align-top break-words font-mono text-sm max-sm:col-span-2 max-sm:p-0 max-sm:font-semibold max-sm:text-ink">
                  {x.name}
                  {x.metaName && x.metaName !== x.name ? <span className="mt-1 block font-sans text-sm font-normal text-muted" data-part="meta-name">{t("wa.tpl.metaname", { name: x.metaName })}</span> : null}
                  {x.optOutLabel ? <span className="mt-1 block font-sans text-sm font-normal text-muted">{t("wa.tpl.optout", { label: x.optOutLabel })}</span> : null}
                </td>
                <td data-label={t("wa.tpl.col.language")} className="px-3 py-2 align-top max-sm:col-start-1 max-sm:row-start-2 max-sm:p-0 max-sm:text-sm max-sm:text-muted">
                  {t(`today.lang.${x.language}`)}
                </td>
                <td data-label={t("wa.tpl.col.purpose")} className="px-3 py-2 align-top max-sm:col-start-1 max-sm:row-start-3 max-sm:p-0 max-sm:text-sm max-sm:text-muted">
                  {["followup", "visit", "order_status", "info"].includes(x.purpose) ? t(`wa.tpl.purpose.${x.purpose}`) : x.purpose}
                </td>
                <td data-label={t("wa.tpl.col.status")} className="px-3 py-2 align-top max-sm:col-start-2 max-sm:row-start-2 max-sm:row-span-2 max-sm:flex max-sm:flex-col max-sm:items-end max-sm:gap-2 max-sm:p-0">
                  <span className={pillClass(tone[x.status])}>{t(`wa.tpl.status.${x.status}`)}</span>
                  {actions && x.status === "draft" ? (
                    <button type="button" className={`${btn} ml-2 max-sm:ml-0`} disabled={busy !== null} onClick={() => void go(x.id, () => actions.submitOne(x.id), () => t("wa.tpl.done.one"), false)} data-part="send-one">
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
