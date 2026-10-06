"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { FILE_TOO_BIG, MAX_FILE_BYTES, issueText, textBytes, type Preview } from "@/lib/api/pricelists";
import { formatBps, formatRupees } from "@/lib/api/quotes";

import type { CommitState, PreviewState } from "./price-list-actions";

type Previewed = { state: PreviewState; checked: { csv: string; date: string; versionId: string } } | undefined;
type PreviewAction = (prev: PreviewState, formData: FormData) => Promise<PreviewState>;
type CommitAction = (prev: CommitState, formData: FormData) => Promise<CommitState>;

/** "10+ ₹4,000.00; 50+ ₹3,900.00": the quantity from which a lower price applies. */
export function breaksText(item: Preview["items"][number]): string {
  return item.breaks.length === 0 ? "none" : item.breaks.map((b) => `${b.min_qty}+ ${formatRupees(b.unit_price_paise)}`).join("; ");
}

/**
 * Load a price list from a CSV file: paste its text or choose a file (it is read in your browser and put in the box), check it, then save it as a new version. A check writes nothing;
 * saving needs a clean check of THIS text and date, and the API checks the file again. Names and skus are shown as plain text. Nothing here sends anything to anyone.
 */
export function PriceListImport({
  preview,
  commit,
  today,
  secondFactorMissing,
}: {
  preview: PreviewAction;
  commit: CommitAction;
  today: string;
  secondFactorMissing: boolean;
}) {
  // a check is tied to the EXACT text and date it was made for (and carries the id of the version it would save): the verdict and the save button belong to that text and date and to nothing else
  const checkThis = async (prev: Previewed, formData: FormData): Promise<Previewed> => {
    const state = await preview(prev?.state, formData);
    return { state, checked: { csv: String(formData.get("csv") ?? ""), date: String(formData.get("effective_from") ?? ""), versionId: crypto.randomUUID() } };
  };
  const [previewed, previewAction, checking] = useActionState(checkThis, undefined);
  const [commitState, commitAction, saving] = useActionState(commit, undefined);
  const [csv, setCsv] = useState("");
  const [date, setDate] = useState(today);
  const [fileError, setFileError] = useState<string | null>(null);
  const previewState = previewed?.state;
  const checked = previewed?.checked ?? null;
  // the verdict is shown only when no check is running and the text and date are exactly the checked ones
  const fresh = !checking && checked !== null && checked.csv === csv && checked.date === date;
  const result = fresh ? previewState?.preview : undefined;
  const current = result?.ok === true;
  const stale = !checking && previewState?.preview !== undefined && !fresh;

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError(FILE_TOO_BIG);
      return;
    }
    setCsv(await file.text());
  }

  return (
    <div>
      <form action={previewAction} className="card" style={{ maxWidth: "50rem" }}>
        <label htmlFor="pl-file">Choose a CSV file</label>
        <input id="pl-file" type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
        {fileError ? (
          <p role="alert" className="error hint">
            {fileError}
          </p>
        ) : null}
        <label htmlFor="pl-csv">Or paste the file&apos;s text</label>
        <textarea id="pl-csv" name="csv" rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} placeholder="sku,name,unit_price,moq,tax_bps" style={{ fontFamily: "monospace" }} />
        <p className="hint">
          Columns: <code>sku, name, unit_price, moq, tax_bps</code> and, optionally, <code>min_qty_1, price_1</code> up to <code>min_qty_5, price_5</code>. Prices are in rupees (4200 or 1,200.50). Every sku must already be a
          product in your catalog.
        </p>
        <label htmlFor="pl-date">The price list starts on</label>
        <input id="pl-date" name="effective_from" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <button
          type="submit"
          disabled={checking}
          onClick={(event) => {
            if (textBytes(csv) > MAX_FILE_BYTES) {
              event.preventDefault(); // over the limit: never sent (the server-action request itself is capped at 1 MB)
              setFileError(FILE_TOO_BIG);
              return;
            }
            setFileError(null);
          }}
        >
          {checking ? "Checking..." : "Check the file"}
        </button>
        <p className="hint">Checking writes nothing.</p>
        {previewState?.error ? (
          <p role="alert" className="error hint">
            {previewState.error}
          </p>
        ) : null}
      </form>

      {stale ? <p className="hint">The text or the date changed since the last check: its result is not shown. Check the file again.</p> : null}
      {result ? (
        <section aria-labelledby="pl-result" className="card" style={{ maxWidth: "70rem" }}>
          <h2 id="pl-result">{result.ok ? "The file is good" : "The file has problems"}</h2>
          {result.issues.length > 0 ? (
            <ul aria-label="Problems in the file">
              {result.issues.map((issue, i) => (
                <li key={`${issue.row}-${issue.column}-${issue.code}-${i}`}>{issueText(issue)}</li>
              ))}
            </ul>
          ) : null}
          {result.items.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table aria-label="What the file would become">
                <thead>
                  <tr>
                    <th scope="col">sku</th>
                    <th scope="col">Name in the file</th>
                    <th scope="col">Name in the catalog</th>
                    <th scope="col">Price</th>
                    <th scope="col">Minimum</th>
                    <th scope="col">GST</th>
                    <th scope="col">Price breaks</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.sku}>
                      <td className="plain-text">{item.sku}</td>
                      <td className="plain-text">{item.name}</td>
                      <td className="plain-text">{item.catalog_name ?? "not in the catalog"}{item.catalog_name && !item.name_matches ? " (differs)" : ""}</td>
                      <td>
                        {formatRupees(item.unit_price_paise)}
                        {item.sale_unit ? ` per ${item.sale_unit}` : ""}
                      </td>
                      <td>{item.minimum_order_quantity}</td>
                      <td>{formatBps(item.tax_bps)}</td>
                      <td>{breaksText(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {result.ok ? <p className="hint">{result.items.length} products. Starts on this date; the catalog&apos;s names stay as they are (the file&apos;s names are only a check).</p> : null}
        </section>
      ) : null}

      {previewState?.preview?.ok || checking ? (
        secondFactorMissing ? (
          <p role="note">
            Saving a price list needs your authenticator app. <Link href="/app/security" className="tap">Set it up on the Security page</Link>, then sign in again with its code.
          </p>
        ) : (
          <form className="card" style={{ maxWidth: "50rem" }}>
            <input type="hidden" name="version_id" value={checked?.versionId ?? ""} />
            <input type="hidden" name="csv" value={csv} />
            <input type="hidden" name="effective_from" value={date} />
            <button type="submit" formAction={commitAction} disabled={saving || checking || !current}>
              {saving ? "Saving..." : "Save as a new price list version"}
            </button>
            {!current && !checking ? <p className="hint">The text or the date changed since the check. Check the file again to save it.</p> : null}
            <p className="hint">Saving makes a new version in force from the date above. Earlier quotes keep the version they were made with. Nothing is sent to anyone.</p>
          </form>
        )
      ) : null}
      {commitState?.error ? (
        <p role="alert" className="error hint">
          {commitState.error}
        </p>
      ) : null}
      {commitState?.ok && commitState.message ? (
        <p role="status" className="hint">
          {commitState.message}
        </p>
      ) : null}
    </div>
  );
}
