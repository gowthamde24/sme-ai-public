"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { FILE_TOO_BIG, MAX_FILE_BYTES, issueText, textBytes, type Preview } from "@/lib/api/pricelists";
import { formatBps, formatRupees } from "@/lib/api/quotes";

import type { CommitState, PreviewState } from "./price-list-actions";
import { alertBox, btnMain, bulletList, codeInline, dataTable, dataTd, dataThCol, dataTr, fieldInput, fieldLabel, fieldMono, formCardWide, link, mutedText, noteBox, okBox, pageH2, plainText, tableWrap } from "@/components/v2/app/ui";

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
      <form action={previewAction} className={formCardWide}>
        <label htmlFor="pl-file" className={fieldLabel}>
        Choose a CSV file
      </label>
        <input id="pl-file" type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className={fieldInput} />
        {fileError ? (
          <p role="alert" className={alertBox}>
            {fileError}
          </p>
        ) : null}
        <label htmlFor="pl-csv" className={fieldLabel}>
        Or paste the file&apos;s text
      </label>
        <textarea id="pl-csv" name="csv" rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} placeholder="sku,name,unit_price,moq,tax_bps" className={fieldMono} />
        <p className={mutedText}>
          Columns: <code className={codeInline}>sku, name, unit_price, moq, tax_bps</code> and, optionally, <code className={codeInline}>min_qty_1, price_1</code> up to <code className={codeInline}>min_qty_5, price_5</code>. Prices are in rupees (4200 or 1,200.50). Every sku must already be a
          product in your catalog.
        </p>
        <label htmlFor="pl-date" className={fieldLabel}>
        The price list starts on
      </label>
        <input id="pl-date" name="effective_from" type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={fieldInput} />
        <button
          type="submit"
          className={btnMain}
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
        <p className={mutedText}>Checking writes nothing.</p>
        {previewState?.error ? (
          <p role="alert" className={alertBox}>
            {previewState.error}
          </p>
        ) : null}
      </form>

      {stale ? <p className={mutedText}>The text or the date changed since the last check: its result is not shown. Check the file again.</p> : null}
      {result ? (
        <section aria-labelledby="pl-result" className={formCardWide}>
          <h2 id="pl-result" className={pageH2}>{result.ok ? "The file is good" : "The file has problems"}</h2>
          {result.issues.length > 0 ? (
            <ul aria-label="Problems in the file" className={bulletList}>
              {result.issues.map((issue, i) => (
                <li key={`${issue.row}-${issue.column}-${issue.code}-${i}`}>{issueText(issue)}</li>
              ))}
            </ul>
          ) : null}
          {result.items.length > 0 ? (
            <div className={tableWrap}>
              <table aria-label="What the file would become" className={dataTable}>
                <thead>
                  <tr>
                    <th scope="col" className={dataThCol}>sku</th>
                    <th scope="col" className={dataThCol}>Name in the file</th>
                    <th scope="col" className={dataThCol}>Name in the catalog</th>
                    <th scope="col" className={dataThCol}>Price</th>
                    <th scope="col" className={dataThCol}>Minimum</th>
                    <th scope="col" className={dataThCol}>GST</th>
                    <th scope="col" className={dataThCol}>Price breaks</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.sku} className={dataTr}>
                      <td data-label="sku" className={`${dataTd} ${plainText}`}>{item.sku}</td>
                      <td data-label="Name in the file" className={`${dataTd} ${plainText}`}>{item.name}</td>
                      <td data-label="Name in the catalog" className={`${dataTd} ${plainText}`}>{item.catalog_name ?? "not in the catalog"}{item.catalog_name && !item.name_matches ? " (differs)" : ""}</td>
                      <td data-label="Price" className={dataTd}>
                        {formatRupees(item.unit_price_paise)}
                        {item.sale_unit ? ` per ${item.sale_unit}` : ""}
                      </td>
                      <td data-label="Minimum" className={dataTd}>{item.minimum_order_quantity}</td>
                      <td data-label="GST" className={dataTd}>{formatBps(item.tax_bps)}</td>
                      <td data-label="Price breaks" className={dataTd}>{breaksText(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {result.ok ? <p className={mutedText}>{result.items.length} products. Starts on this date; the catalog&apos;s names stay as they are (the file&apos;s names are only a check).</p> : null}
        </section>
      ) : null}

      {previewState?.preview?.ok || checking ? (
        secondFactorMissing ? (
          <p role="note" className={noteBox}>
            Saving a price list needs your authenticator app. <Link href="/app/security" className={link}>Set it up on the Security page</Link>, then sign in again with its code.
          </p>
        ) : (
          <form className={formCardWide}>
            <input type="hidden" name="version_id" value={checked?.versionId ?? ""} />
            <input type="hidden" name="csv" value={csv} />
            <input type="hidden" name="effective_from" value={date} />
            <button type="submit" formAction={commitAction} className={btnMain} disabled={saving || checking || !current}>
              {saving ? "Saving..." : "Save as a new price list version"}
            </button>
            {!current && !checking ? <p className={mutedText}>The text or the date changed since the check. Check the file again to save it.</p> : null}
            <p className={mutedText}>Saving makes a new version in force from the date above. Earlier quotes keep the version they were made with. Nothing is sent to anyone.</p>
          </form>
        )
      ) : null}
      {commitState?.error ? (
        <p role="alert" className={alertBox}>
          {commitState.error}
        </p>
      ) : null}
      {commitState?.ok && commitState.message ? (
        <p role="status" className={okBox}>
          {commitState.message}
        </p>
      ) : null}
    </div>
  );
}
