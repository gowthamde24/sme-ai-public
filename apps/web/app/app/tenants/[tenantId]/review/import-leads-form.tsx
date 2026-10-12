"use client";

import { useActionState, useState } from "react";

import type { ImportRowOutcome } from "@/lib/api/leads";

import { Pill } from "@/components/v2/app/parts";
import { alertBox, btnMain, btnQuiet, codeInline, dataTable, dataTd, dataThCol, dataTr, fieldInput, fieldLabel, fieldMono, formCardWide, mutedText, pageH3, rowBetween, rowWrap, sectionBlock, spaceTop } from "@/components/v2/app/ui";

import { importLeadsAction, type ImportActionState } from "./actions";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";

interface ImportLeadsFormProps {
  tenantId: string; words?: Words;
}

const SAMPLE_IMPORT_TEMPLATE = `[
  {
    "company_name": "Sri Lakshmi Sarees",
    "city": "Bengaluru",
    "buyer_type": "saree_shop",
    "contact_name": "Ramesh Kumar",
    "contact_phone": "+00 9876543210",
    "contact_email": "ramesh@example.test"
  }
]`;

export function ImportLeadsForm({ tenantId, words }: ImportLeadsFormProps) {
  const t = makeT(words);
  const [isOpen, setIsOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [isDryRun, setIsDryRun] = useState(true);

  const boundAction = importLeadsAction.bind(null, tenantId);
  const [state, formAction, isPending] = useActionState<ImportActionState, FormData>(
    boundAction,
    {},
  );

  return (
    <div className={sectionBlock}>
      <button
        type="button"
        className={btnQuiet}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        {isOpen ? t("rev.hide_batch_lead_import") : t("rev.import_candidate_leads")}
      </button>

      {isOpen && (
        <form action={formAction} className={formCardWide}>
          <input type="hidden" name="dry_run" value={isDryRun ? "true" : "false"} />

          <label htmlFor="batch_label" className={fieldLabel}>
            {t("rev.batch_label_optional")}
          </label>
          <input
            id="batch_label"
            className={fieldInput}
            name="batch_label"
            type="text"
            placeholder={t("rev.e_g_bangalore_silk_fair_october")}
            maxLength={60}
            disabled={isPending}
          />

          <div className={rowBetween}>
            <label htmlFor="raw_json" className={fieldLabel}>{t("rev.candidate_leads_json_array")}</label>
            <button
              type="button"
              className={btnQuiet}
              onClick={() => setJsonText(SAMPLE_IMPORT_TEMPLATE)}
            >
              {t("rev.fill_sample_template")}
            </button>
          </div>

          <textarea
            id="raw_json"
            className={fieldMono}
            name="raw_json"
            rows={8}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder={t("rev.paste_json_array_of_lead_rows")}
            disabled={isPending}
            required
          />
          <p className={mutedText}>
            <Rich t={t} k="rev.allowed_fields" with={{
              company: <code className={codeInline}>company_name</code>, city: <code className={codeInline}>city</code>, country: <code className={codeInline}>country</code>, website: <code className={codeInline}>website</code>,
              industry: <code className={codeInline}>industry</code>, buyer: <code className={codeInline}>buyer_type</code>, cname: <code className={codeInline}>contact_name</code>, phone: <code className={codeInline}>contact_phone</code>, email: <code className={codeInline}>contact_email</code>,
            }} />
          </p>

          <div className={rowWrap}>
            <button
              type="submit"
              className={btnQuiet}
              disabled={isPending}
              onClick={() => setIsDryRun(true)}
            >
              {isPending && isDryRun ? t("rev.checking") : t("rev.preview_dry_run")}
            </button>

            <button
              type="submit"
              className={btnMain}
              disabled={isPending}
              onClick={() => setIsDryRun(false)}
            >
              {isPending && !isDryRun ? t("rev.importing") : t("rev.commit_import")}
            </button>
          </div>

          {state?.error && (
            <p role="alert" className={alertBox}>
              {state.error}
            </p>
          )}

          {state?.ok && state?.report && (
            <div className={spaceTop}>
              <h3 className={pageH3}>
                {state.report.dry_run ? t("rev.preview_summary_dry_run") : t("rev.import_completed")}
                {state.report.replayed && " " + t("rev.idempotent_replay")}
              </h3>
              <p className={mutedText}>
                <Rich t={t} k="rev.report_line" with={{
                  rows: <strong>{state.report.counts.rows}</strong>, companies: <strong>{state.report.counts.companies_created}</strong>, contacts: <strong>{state.report.counts.contacts_created}</strong>,
                  claims: <strong>{state.report.counts.claims_created}</strong>, skipped: <strong>{state.report.counts.skipped_duplicate}</strong>, rejected: <strong>{state.report.counts.rejected}</strong>,
                }} />
              </p>

              {state.report.rows && state.report.rows.length > 0 && (
                <table className={`mt-4 ${dataTable}`}>
                  <thead>
                    <tr>
                      <th className={dataThCol}>{t("rev.row")}</th>
                      <th className={dataThCol}>{t("rev.outcome")}</th>
                      <th className={dataThCol}>{t("rev.company")}</th>
                      <th className={dataThCol}>{t("rev.contact")}</th>
                      <th className={dataThCol}>{t("rev.notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.report.rows.slice(0, 10).map((r: ImportRowOutcome) => (
                      <tr key={r.row} className={dataTr}>
                        <td data-label={t("rev.col_row")} className={dataTd}>{r.row}</td>
                        <td data-label={t("rev.col_outcome")} className={dataTd}>
                          <Pill tone={r.outcome === "created" ? "green" : "neutral"}>{r.outcome}</Pill>
                        </td>
                        <td data-label={t("rev.col_company")} className={dataTd}>{r.company_created ? t("rev.created") : t("rev.matched_skipped")}</td>
                        <td data-label={t("rev.col_contact")} className={dataTd}>{r.contact_created ? t("rev.created") : "—"}</td>
                        <td data-label={t("rev.col_notes")} className={dataTd}>{r.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
