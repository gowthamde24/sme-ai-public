"use client";

import { useActionState, useState } from "react";

import type { ImportRowOutcome } from "@/lib/api/leads";

import { Pill } from "@/components/v2/app/parts";
import { alertBox, btnMain, btnQuiet, codeInline, dataTable, dataTd, dataThCol, dataTr, fieldInput, fieldLabel, fieldMono, formCardWide, mutedText, pageH3, rowBetween, rowWrap, sectionBlock, spaceTop } from "@/components/v2/app/ui";

import { importLeadsAction, type ImportActionState } from "./actions";

interface ImportLeadsFormProps {
  tenantId: string;
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

export function ImportLeadsForm({ tenantId }: ImportLeadsFormProps) {
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
        {isOpen ? "Hide Batch Lead Import" : "Import Candidate Leads"}
      </button>

      {isOpen && (
        <form action={formAction} className={formCardWide}>
          <input type="hidden" name="dry_run" value={isDryRun ? "true" : "false"} />

          <label htmlFor="batch_label" className={fieldLabel}>
            Batch Label (optional):
          </label>
          <input
            id="batch_label"
            className={fieldInput}
            name="batch_label"
            type="text"
            placeholder="e.g. Bangalore Silk Fair October"
            maxLength={60}
            disabled={isPending}
          />

          <div className={rowBetween}>
            <label htmlFor="raw_json" className={fieldLabel}>Candidate Leads (JSON array):</label>
            <button
              type="button"
              className={btnQuiet}
              onClick={() => setJsonText(SAMPLE_IMPORT_TEMPLATE)}
            >
              Fill Sample Template
            </button>
          </div>

          <textarea
            id="raw_json"
            className={fieldMono}
            name="raw_json"
            rows={8}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder="Paste JSON array of lead rows..."
            disabled={isPending}
            required
          />
          <p className={mutedText}>
            Allowed fields: <code className={codeInline}>company_name</code> (required), <code className={codeInline}>city</code>, <code className={codeInline}>country</code>, <code className={codeInline}>website</code>, <code className={codeInline}>industry</code>, <code className={codeInline}>buyer_type</code>, <code className={codeInline}>contact_name</code>, <code className={codeInline}>contact_phone</code> (must start with +00 in test mode), <code className={codeInline}>contact_email</code> (.test/.example domain).
          </p>

          <div className={rowWrap}>
            <button
              type="submit"
              className={btnQuiet}
              disabled={isPending}
              onClick={() => setIsDryRun(true)}
            >
              {isPending && isDryRun ? "Checking..." : "Preview (Dry Run)"}
            </button>

            <button
              type="submit"
              className={btnMain}
              disabled={isPending}
              onClick={() => setIsDryRun(false)}
            >
              {isPending && !isDryRun ? "Importing..." : "Commit Import"}
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
                {state.report.dry_run ? "Preview Summary (Dry Run)" : "Import Completed"}
                {state.report.replayed && " (Idempotent Replay)"}
              </h3>
              <p className={mutedText}>
                Processed: <strong>{state.report.counts.rows}</strong> rows ·
                Created: <strong>{state.report.counts.companies_created}</strong> companies,{" "}
                <strong>{state.report.counts.contacts_created}</strong> contacts,{" "}
                <strong>{state.report.counts.claims_created}</strong> claims ·
                Skipped duplicates: <strong>{state.report.counts.skipped_duplicate}</strong> ·
                Rejected: <strong>{state.report.counts.rejected}</strong>
              </p>

              {state.report.rows && state.report.rows.length > 0 && (
                <table className={`mt-4 ${dataTable}`}>
                  <thead>
                    <tr>
                      <th className={dataThCol}>Row</th>
                      <th className={dataThCol}>Outcome</th>
                      <th className={dataThCol}>Company</th>
                      <th className={dataThCol}>Contact</th>
                      <th className={dataThCol}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.report.rows.slice(0, 10).map((r: ImportRowOutcome) => (
                      <tr key={r.row} className={dataTr}>
                        <td data-label="Row" className={dataTd}>{r.row}</td>
                        <td data-label="Outcome" className={dataTd}>
                          <Pill tone={r.outcome === "created" ? "green" : "neutral"}>{r.outcome}</Pill>
                        </td>
                        <td data-label="Company" className={dataTd}>{r.company_created ? "Created" : "Matched/Skipped"}</td>
                        <td data-label="Contact" className={dataTd}>{r.contact_created ? "Created" : "—"}</td>
                        <td data-label="Notes" className={dataTd}>{r.reason ?? "—"}</td>
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
