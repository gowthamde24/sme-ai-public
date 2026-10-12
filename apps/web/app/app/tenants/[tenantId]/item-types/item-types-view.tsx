import { Fragment, type ReactNode } from "react";

import type { ItemType } from "@/lib/api/item-types";
import { formatRupees } from "@/lib/api/quotes";

import { RANGE_SENTENCE, inListOrder } from "./item-types-logic";
import { bodyText, dataEditCell, dataEditRow, dataTable, dataTdEditWide, dataTdStack, dataThCol, dataThRowWide, dataTrGrid, mutedText, pageH1, plainText, summaryLine } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

const price = (paise: number | null) => (paise === null ? "none" : formatRupees(paise));

/**
 * The workspace's item types in the owner's order: name, code, whether it can be used on a new quote, and the optional lowest and highest price, as a table (one block per type on a phone). `editor(type)` is the edit
 * form for a person who may change it (the page passes nothing for a reader, so a reader's page has no control at all). Its "Edit" control is a `<details>` in the row; the form sits in the row
 * under it and the stylesheet shows it while the control is open (a browser without `:has` shows every form). `adder` is the add form (also only for a person who may).
 */
export function ItemTypesView({ types, adder, editor, tabs = null, words }: { types: ItemType[]; adder: ReactNode; editor: ((type: ItemType) => ReactNode) | null; tabs?: ReactNode; words?: Words; }) {
  const t = makeT(words);
  const ordered = inListOrder(types);
  return (
    <section aria-labelledby="item-types-heading">
      <h1 id="item-types-heading" className={pageH1}>
        {t("it.item_types")}
      </h1>
      {tabs}
      <p className={bodyText}>{t("it.item_types_are_the_kinds_of")}</p>
      <p className={mutedText}>{RANGE_SENTENCE}</p>
      <p className={mutedText}>{t("it.changing_a_price_range_does_not")}</p>
      {ordered.length === 0 ? <p className={bodyText}>{t("it.none_yet")}{editor ? " " + t("it.add_the_first_one_below") : ""}</p> : null}
      {adder}
      {ordered.length === 0 ? null : (
        <table aria-label={t("it.item_types_in_order")} className={`mt-4 ${dataTable}`}>
          <thead>
            <tr>
              <th scope="col" className={dataThCol}>{t("it.name")}</th>
              <th scope="col" className={dataThCol}>{t("it.code")}</th>
              <th scope="col" className={dataThCol}>{t("it.can_be_used")}</th>
              <th scope="col" className={dataThCol}>{t("it.position")}</th>
              <th scope="col" className={dataThCol}>{t("it.lowest_price")}</th>
              <th scope="col" className={dataThCol}>{t("it.highest_price")}</th>
              {editor ? <th scope="col" className={dataThCol}>{t("it.edit")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {ordered.map((type) => (
              <Fragment key={type.id}>
                <tr className={dataTrGrid}>
                  <th scope="row" className={`${dataThRowWide} ${plainText}`}>
                    {type.name}
                  </th>
                  <td data-label={t("it.col_code")} className={`${dataTdStack} ${plainText}`}>
                    {type.code}
                  </td>
                  <td data-label={t("it.col_can_be_used")} className={dataTdStack}>{type.active ? t("it.yes") : t("it.no_switched_off")}</td>
                  <td data-label={t("it.col_position")} className={dataTdStack}>{type.position}</td>
                  <td data-label={t("it.col_lowest_price")} className={dataTdStack}>{price(type.min_price_paise)}</td>
                  <td data-label={t("it.col_highest_price")} className={dataTdStack}>{price(type.max_price_paise)}</td>
                  {editor ? (
                    <td className={dataTdEditWide}>
                      <details>
                        <summary className={summaryLine}>{t("it.edit_name", { name: type.name })}</summary>
                      </details>
                    </td>
                  ) : null}
                </tr>
                {editor ? (
                  <tr className={dataEditRow}>
                    <td colSpan={7} className={dataEditCell}>{editor(type)}</td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
