"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { FILE_TOO_BIG, MAX_FILE_BYTES, issueText, textBytes, type Preview } from "@/lib/api/pricelists";
import { formatBps, formatRupees } from "@/lib/api/quotes";

import type { CommitState, PreviewState } from "./price-list-actions";
import { alertBox, btnMain, bulletList, codeInline, dataTable, dataTd, dataThCol, dataTr, fieldInput, fieldLabel, fieldMono, formCardWide, link, mutedText, noteBox, okBox, pageH2, plainText, tableWrap } from "@/components/v2/app/ui";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";

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
  secondFactorMissing, words,
}: {
  preview: PreviewAction;
  commit: CommitAction;
  today: string;
  secondFactorMissing: boolean; words?: Words;
}) {
  const t = makeT(words);
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
        {t("pl.choose_a_csv_file")}
      </label>
        <input id="pl-file" type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className={fieldInput} />
        {fileError ? (
          <p role="alert" className={alertBox}>
            {fileError}
          </p>
        ) : null}
        <label htmlFor="pl-csv" className={fieldLabel}>
        {t("pl.or_paste_the_file_s_text")}
      </label>
        <textarea id="pl-csv" name="csv" rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} placeholder="sku,name,unit_price,moq,tax_bps" className={fieldMono} />
        <p className={mutedText}>
          <Rich t={t} k="pl.columns_line" with={{ cols: <code className={codeInline}>sku, name, unit_price, moq, tax_bps</code>, first: <code className={codeInline}>min_qty_1, price_1</code>, last: <code className={codeInline}>min_qty_5, price_5</code> }} />
        </p>
        <label htmlFor="pl-date" className={fieldLabel}>
        {t("pl.the_price_list_starts_on")}
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
          {checking ? t("pl.checking") : t("pl.check_the_file")}
        </button>
        <p className={mutedText}>{t("pl.checking_writes_nothing")}</p>
        {previewState?.error ? (
          <p role="alert" className={alertBox}>
            {previewState.error}
          </p>
        ) : null}
      </form>

      {stale ? <p className={mutedText}>{t("pl.the_text_or_the_date_changed")}</p> : null}
      {result ? (
        <section aria-labelledby="pl-result" className={formCardWide}>
          <h2 id="pl-result" className={pageH2}>{result.ok ? t("pl.the_file_is_good") : t("pl.the_file_has_problems")}</h2>
          {result.issues.length > 0 ? (
            <ul aria-label={t("pl.problems_in_the_file")} className={bulletList}>
              {result.issues.map((issue, i) => (
                <li key={`${issue.row}-${issue.column}-${issue.code}-${i}`}>{issueText(issue)}</li>
              ))}
            </ul>
          ) : null}
          {result.items.length > 0 ? (
            <div className={tableWrap}>
              <table aria-label={t("pl.what_the_file_would_become")} className={dataTable}>
                <thead>
                  <tr>
                    <th scope="col" className={dataThCol}>{t("pl.sku")}</th>
                    <th scope="col" className={dataThCol}>{t("pl.name_in_the_file")}</th>
                    <th scope="col" className={dataThCol}>{t("pl.name_in_the_catalog")}</th>
                    <th scope="col" className={dataThCol}>{t("pl.price")}</th>
                    <th scope="col" className={dataThCol}>{t("pl.minimum")}</th>
                    <th scope="col" className={dataThCol}>{t("pl.gst")}</th>
                    <th scope="col" className={dataThCol}>{t("pl.price_breaks")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.sku} className={dataTr}>
                      <td data-label={t("pl.col_sku")} className={`${dataTd} ${plainText}`}>{item.sku}</td>
                      <td data-label={t("pl.col_name_in_the_file")} className={`${dataTd} ${plainText}`}>{item.name}</td>
                      <td data-label={t("pl.col_name_in_the_catalog")} className={`${dataTd} ${plainText}`}>{item.catalog_name ?? t("pl.not_in_the_catalog")}{item.catalog_name && !item.name_matches ? " " + t("pl.differs") : ""}</td>
                      <td data-label={t("pl.col_price")} className={dataTd}>
                        {formatRupees(item.unit_price_paise)}
                        {item.sale_unit ? ` per ${item.sale_unit}` : ""}
                      </td>
                      <td data-label={t("pl.col_minimum")} className={dataTd}>{item.minimum_order_quantity}</td>
                      <td data-label={t("pl.col_gst")} className={dataTd}>{formatBps(item.tax_bps)}</td>
                      <td data-label={t("pl.col_price_breaks")} className={dataTd}>{breaksText(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {result.ok ? <p className={mutedText}>{t("pl.preview_note", { n: result.items.length })}</p> : null}
        </section>
      ) : null}

      {previewState?.preview?.ok || checking ? (
        secondFactorMissing ? (
          <p role="note" className={noteBox}>
            {t("pl.mfa_saving_a_price_list")} <Link href="/app/security" className={link}>{t("pl.set_it_up_on_the_security")}</Link>{t("pl.mfa_b")}
          </p>
        ) : (
          <form className={formCardWide}>
            <input type="hidden" name="version_id" value={checked?.versionId ?? ""} />
            <input type="hidden" name="csv" value={csv} />
            <input type="hidden" name="effective_from" value={date} />
            <button type="submit" formAction={commitAction} className={btnMain} disabled={saving || checking || !current}>
              {saving ? t("pl.saving") : t("pl.save_as_a_new_price_list")}
            </button>
            {!current && !checking ? <p className={mutedText}>{t("pl.the_text_or_the_date_changed_2")}</p> : null}
            <p className={mutedText}>{t("pl.saving_makes_a_new_version_in")}</p>
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
