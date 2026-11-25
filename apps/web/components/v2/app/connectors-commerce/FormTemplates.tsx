"use client";

import * as React from "react";

import type { FormTemplate, FormTemplateListing } from "@/lib/api/commerce-notify";

import { makeT, type Words } from "../words";
import type { CommerceActions } from "./actions";
import { CardBox, CopyField, Notice, useRunner } from "./parts";

/**
 * The lead-form templates (docs/contracts/commerce-notify.md section A): Google Ads lead forms, Typeform, Tally, Jotform, LinkedIn through Zapier or Make, Webflow, and the TradeIndia lead mail. A card opens to the steps in plain words (the
 * lead address is already written into them), the body the tool sends, which of its fields we read, how consent is sent and what is not checked yet with a real account. Developer-facing text arrives from the API in English.
 */
export function FormTemplates({ items, words, actions, readOnly }: { items: FormTemplateListing[]; words: Words; actions: CommerceActions; readOnly: boolean }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0" data-part="form-templates">
      {items.map((it) => (
        <TemplateCard key={it.id} item={it} words={words} actions={actions} readOnly={readOnly} open={openId === it.id} onToggle={() => setOpenId((c) => (c === it.id ? null : it.id))} />
      ))}
    </ul>
  );
}

function TemplateCard({ item, words, actions, readOnly, open, onToggle }: { item: FormTemplateListing; words: Words; actions: CommerceActions; readOnly: boolean; open: boolean; onToggle: () => void }) {
  const t = makeT(words);
  const r = useRunner(t);
  const [detail, setDetail] = React.useState<FormTemplate | null>(null);
  const toggle = () => {
    onToggle();
    if (!open && !detail && !readOnly) void r.run(() => actions.formTemplate(item.id), (x) => setDetail(x.template));
  };
  return (
    <CardBox id={item.id} group="forms" title={item.name} state="not_connected" stateText={t(`cn.form.${item.group === "mail" ? "mail" : "web"}`)} open={open} onToggle={toggle} openWord={t("cn.open")} closeWord={t("cn.close")}>
      {r.problem ? <Notice role="alert" tone="brand">{r.problem}</Notice> : null}
      {detail ? <Detail d={detail} words={words} /> : r.busy ? <p className="m-0 text-[15px] text-muted">{t("cn.loading")}</p> : null}
    </CardBox>
  );
}

function Detail({ d, words }: { d: FormTemplate; words: Words }) {
  const t = makeT(words);
  return (
    <div className="flex flex-col gap-4" lang="en" data-part="form-detail">
      <ol className="m-0 list-decimal pl-5 text-[15px] text-ink">
        {d.steps.map((s) => (
          <li key={s} className="py-0.5">
            {s}
          </li>
        ))}
      </ol>
      <CopyField words={words} id={`${d.id}-sample`} label={t("cn.form.sample")} value={d.sample} multiline lang="en" />
      {d.mapping.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[15px]">
            <thead>
              <tr>
                <th scope="col" className="border-b border-line px-2 py-2 text-[14px] font-semibold text-muted">
                  {t("cn.form.theirs")}
                </th>
                <th scope="col" className="border-b border-line px-2 py-2 text-[14px] font-semibold text-muted">
                  {t("cn.form.ours")}
                </th>
              </tr>
            </thead>
            <tbody>
              {d.mapping.map(([a, b]) => (
                <tr key={a}>
                  <td className="border-b border-line px-2 py-2 font-mono text-[14px] text-ink">{a}</td>
                  <td className="border-b border-line px-2 py-2 text-muted">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {d.consent ? <Notice>{d.consent}</Notice> : null}
      {d.verify.length > 0 ? (
        <div>
          <h4 className="m-0 text-[15px] font-semibold text-ink">{t("cn.form.verify")}</h4>
          <ul className="m-0 mt-1 list-disc pl-5 text-[14px] text-muted">
            {d.verify.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.docs.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
          {d.docs.map((u) => (
            <li key={u}>
              <a href={u} target="_blank" rel="noopener noreferrer" className="text-brand-text underline underline-offset-2">
                {u}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
