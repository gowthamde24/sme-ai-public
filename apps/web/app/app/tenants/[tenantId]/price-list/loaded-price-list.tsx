import { redirect } from "next/navigation";

import { ApiAuthError } from "@/lib/api/client";
import { fetchLoadedPriceList, type LoadedPriceList } from "@/lib/api/pricelists";
import { formatRupees } from "@/lib/api/quotes";

import { dataTable, dataTdStack, dataThCol, dataThRowWide, dataTrGrid, mutedText, noteBox, plainText } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";
import { sectionH2First } from "../item-types/section-h2";

const date = (day: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
/** 500 basis points is "5%": the GST of a row, said the way an owner says it. */
const gst = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/**
 * "Your price list now" (owner, 15 Nov 2026), on top of the Price lists page: the version in force (its number, the day it starts, how many products) with its first rows, and a later version when one is waiting. Server side
 * only: it reads `GET /price-lists/current` with the person's own token. A list nobody has loaded yet says so in one sentence; a list that cannot be read says so in one sentence and the rest of the page stays.
 */
export async function LoadedPriceListSection({ accessToken, tenantId, words }: { accessToken: string; tenantId: string; words: Words }) {
  const t = makeT(words);
  let loaded: LoadedPriceList | null = null;
  try {
    loaded = await fetchLoadedPriceList(accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    loaded = null;
  }
  const cur = loaded?.current ?? null;
  return (
    <section aria-labelledby="loaded-list-heading" data-part="loaded-list">
      <h2 id="loaded-list-heading" className={sectionH2First}>
        {t("pl.current.title")}
      </h2>
      {loaded === null ? (
        <p role="alert" className={noteBox}>
          {t("pl.current.unavailable")}
        </p>
      ) : cur === null ? (
        <p className={mutedText}>{t("pl.current.none")}</p>
      ) : (
        <>
          <p className="mt-1 text-base font-semibold">{t("pl.current.line", { n: cur.version_no, date: date(cur.effective_from), count: cur.item_count })}</p>
          {cur.sample.length > 0 ? (
            <table aria-label={t("pl.current.title")} className={`mt-3 ${dataTable}`}>
              <thead>
                <tr>
                  <th scope="col" className={dataThCol}>{t("pl.col.name")}</th>
                  <th scope="col" className={dataThCol}>{t("pl.col.sku")}</th>
                  <th scope="col" className={dataThCol}>{t("pl.col.unit")}</th>
                  <th scope="col" className={dataThCol}>{t("pl.col.price")}</th>
                  <th scope="col" className={dataThCol}>{t("pl.col.moq")}</th>
                  <th scope="col" className={dataThCol}>{t("pl.col.gst")}</th>
                </tr>
              </thead>
              <tbody>
                {cur.sample.map((r) => (
                  <tr key={r.sku} className={dataTrGrid}>
                    <th scope="row" className={`${dataThRowWide} ${plainText}`}>
                      {r.name}
                    </th>
                    <td data-label={t("pl.col.sku")} className={`${dataTdStack} ${plainText}`}>{r.sku}</td>
                    <td data-label={t("pl.col.unit")} className={dataTdStack}>{r.sale_unit ?? "-"}</td>
                    <td data-label={t("pl.col.price")} className={dataTdStack}>{formatRupees(r.unit_price_paise)}</td>
                    <td data-label={t("pl.col.moq")} className={dataTdStack}>{r.minimum_order_quantity}</td>
                    <td data-label={t("pl.col.gst")} className={dataTdStack}>{gst(r.tax_bps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {cur.item_count > cur.sample.length ? <p className={mutedText}>{t("pl.current.sample", { shown: cur.sample.length, count: cur.item_count })}</p> : null}
        </>
      )}
      {loaded?.upcoming ? <p className={mutedText}>{t("pl.current.upcoming", { n: loaded.upcoming.version_no, date: date(loaded.upcoming.effective_from), count: loaded.upcoming.item_count })}</p> : null}
    </section>
  );
}
