import { count, dayLabelLong, dayOfIso } from "@/lib/topups/logic";
import type { Invoice, Purchase } from "@/lib/topups/types";
import { formatRupeesShort } from "@/lib/money";

import { surfaceFlat } from "../ui";
import { makeT, type Words } from "../words";
import { SHORT } from "./alert-text";

/**
 * What was bought and the invoices (night 4, part F2). The invoices are FAKE records with the GST fields (amount, CGST and SGST or IGST, total, the buyer's GSTIN when it is set): the page says so, once, above them. Money is
 * written down as given (integer paise from the API, the mock's own test amounts in test mode). A SERVER part.
 */
export function TopupHistory({ words, history, invoices }: { words: Words; history: Purchase[]; invoices: Invoice[] }) {
  const t = makeT(words);
  return (
    <div className="flex flex-col gap-5" data-topups="history">
      <section aria-labelledby="tu-hist-h">
        <h3 id="tu-hist-h" className="font-display text-lg font-semibold">
          {t("tu.hist.title")}
        </h3>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("tu.hist.none")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {history.map((p) => (
              <li key={p.id} className={`${surfaceFlat} !p-3`} data-purchase={p.packCode}>
                <p className="font-medium">{t(`tu.pack.${SHORT[p.kind]}`, { n: count(p.units) })}</p>
                <p className="text-sm text-muted">
                  {dayLabelLong(dayOfIso(p.purchasedAt))} · {formatRupeesShort(p.totalPaise)} · {t(`tu.hist.src.${p.source}`)}
                </p>
                <p className="text-sm text-muted">{t("tu.hist.left", { n: count(p.unitsLeft), date: dayLabelLong(dayOfIso(p.expiresAt)) })}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="tu-inv-h">
        <h3 id="tu-inv-h" className="font-display text-lg font-semibold">
          {t("tu.inv.title")}
        </h3>
        {invoices.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("tu.inv.none")}</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">{t("tu.inv.fake")}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {invoices.map((i) => (
                <li key={i.id} className={`${surfaceFlat} !p-3`} data-invoice={i.number}>
                  <p className="font-medium">
                    {i.number} · {dayLabelLong(dayOfIso(i.issuedAt))}
                  </p>
                  <p className="text-sm">{i.description}</p>
                  <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-sm tabular-nums [&>dt]:text-muted">
                    <dt>{t("tu.inv.taxable")}</dt>
                    <dd>{formatRupeesShort(i.taxablePaise)}</dd>
                    {i.cgstPaise > 0 || i.sgstPaise > 0 ? (
                      <>
                        <dt>{t("tu.inv.cgst", { rate: i.gstRateBp / 200 })}</dt>
                        <dd>{formatRupeesShort(i.cgstPaise)}</dd>
                        <dt>{t("tu.inv.sgst", { rate: i.gstRateBp / 200 })}</dt>
                        <dd>{formatRupeesShort(i.sgstPaise)}</dd>
                      </>
                    ) : (
                      <>
                        <dt>{t("tu.inv.igst", { rate: i.gstRateBp / 100 })}</dt>
                        <dd>{formatRupeesShort(i.igstPaise)}</dd>
                      </>
                    )}
                    <dt className="font-semibold">{t("tu.inv.total")}</dt>
                    <dd className="font-semibold">{formatRupeesShort(i.totalPaise)}</dd>
                  </dl>
                  <p className="mt-1 text-sm text-muted">{i.buyerGstin ? t("tu.inv.buyer", { gstin: i.buyerGstin }) : t("tu.inv.nogstin")}</p>
                  <p className="text-sm text-muted">{t("tu.inv.seller", { name: i.sellerName })}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
