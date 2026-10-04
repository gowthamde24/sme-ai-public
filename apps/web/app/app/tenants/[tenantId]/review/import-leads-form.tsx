"use client";

import { useActionState, useState } from "react";

import type { ImportRowOutcome } from "@/lib/api/leads";

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
    <div style={{ margin: "1.5rem 0" }}>
      <button
        type="button"
        className="secondary"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        {isOpen ? "Hide Batch Lead Import" : "Import Candidate Leads"}
      </button>

      {isOpen && (
        <form action={formAction} className="card" style={{ maxWidth: "48rem", marginTop: "1rem" }}>
          <input type="hidden" name="dry_run" value={isDryRun ? "true" : "false"} />

          <label htmlFor="batch_label">
            Batch Label (optional):
          </label>
          <input
            id="batch_label"
            name="batch_label"
            type="text"
            placeholder="e.g. Bangalore Silk Fair October"
            maxLength={60}
            disabled={isPending}
          />

          <div className="row between">
            <label htmlFor="raw_json">Candidate Leads (JSON array):</label>
            <button
              type="button"
              className="secondary hint"
              style={{ padding: "0.25rem 0.5rem" }}
              onClick={() => setJsonText(SAMPLE_IMPORT_TEMPLATE)}
            >
              Fill Sample Template
            </button>
          </div>

          <textarea
            id="raw_json"
            name="raw_json"
            rows={8}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder="Paste JSON array of lead rows..."
            disabled={isPending}
            required
          />
          <p className="hint">
            Allowed fields: <code>company_name</code> (required), <code>city</code>, <code>country</code>, <code>website</code>, <code>industry</code>, <code>buyer_type</code>, <code>contact_name</code>, <code>contact_phone</code> (must start with +00 in test mode), <code>contact_email</code> (.test/.example domain).
          </p>

          <div className="row">
            <button
              type="submit"
              className="secondary"
              disabled={isPending}
              onClick={() => setIsDryRun(true)}
            >
              {isPending && isDryRun ? "Checking..." : "Preview (Dry Run)"}
            </button>

            <button
              type="submit"
              disabled={isPending}
              onClick={() => setIsDryRun(false)}
            >
              {isPending && !isDryRun ? "Importing..." : "Commit Import"}
            </button>
          </div>

          {state?.error && (
            <p role="alert" className="error">
              {state.error}
            </p>
          )}

          {state?.ok && state?.report && (
            <div style={{ marginTop: "1rem" }}>
              <h3>
                {state.report.dry_run ? "Preview Summary (Dry Run)" : "Import Completed"}
                {state.report.replayed && " (Idempotent Replay)"}
              </h3>
              <p className="hint">
                Processed: <strong>{state.report.counts.rows}</strong> rows ·
                Created: <strong>{state.report.counts.companies_created}</strong> companies,{" "}
                <strong>{state.report.counts.contacts_created}</strong> contacts,{" "}
                <strong>{state.report.counts.claims_created}</strong> claims ·
                Skipped duplicates: <strong>{state.report.counts.skipped_duplicate}</strong> ·
                Rejected: <strong>{state.report.counts.rejected}</strong>
              </p>

              {state.report.rows && state.report.rows.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Outcome</th>
                      <th>Company</th>
                      <th>Contact</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.report.rows.slice(0, 10).map((r: ImportRowOutcome) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td>
                          <span className={`badge badge-${r.outcome === "created" ? "priority" : "low-priority"}`}>
                            {r.outcome}
                          </span>
                        </td>
                        <td>{r.company_created ? "Created" : "Matched/Skipped"}</td>
                        <td>{r.contact_created ? "Created" : "—"}</td>
                        <td>{r.reason ?? "—"}</td>
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
