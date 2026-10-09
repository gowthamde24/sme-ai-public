import { Fragment, type ReactNode } from "react";

import type { ItemType } from "@/lib/api/item-types";
import { formatRupees } from "@/lib/api/quotes";

import { RANGE_SENTENCE, inListOrder } from "./item-types-logic";
import { bodyText, dataEditCell, dataEditRow, dataTable, dataTdEditWide, dataTdStack, dataThCol, dataThRowWide, dataTrGrid, mutedText, pageH1, plainText, summaryLine } from "@/components/v2/app/ui";

const price = (paise: number | null) => (paise === null ? "none" : formatRupees(paise));

/**
 * The workspace's item types in the owner's order: name, code, whether it can be used on a new quote, and the optional lowest and highest price, as a table (one block per type on a phone). `editor(type)` is the edit
 * form for a person who may change it (the page passes nothing for a reader, so a reader's page has no control at all). Its "Edit" control is a `<details>` in the row; the form sits in the row
 * under it and the stylesheet shows it while the control is open (a browser without `:has` shows every form). `adder` is the add form (also only for a person who may).
 */
export function ItemTypesView({ types, adder, editor }: { types: ItemType[]; adder: ReactNode; editor: ((type: ItemType) => ReactNode) | null }) {
  const ordered = inListOrder(types);
  return (
    <section aria-labelledby="item-types-heading">
      <h1 id="item-types-heading" className={pageH1}>
        Item types
      </h1>
      <p className={bodyText}>Item types are the kinds of goods you quote, for example &quot;Type A&quot;. Each line of a quote with typed prices uses one.</p>
      <p className={mutedText}>{RANGE_SENTENCE}</p>
      <p className={mutedText}>Changing a price range does not change quotes that are already made.</p>
      {ordered.length === 0 ? <p className={bodyText}>No item types yet.{editor ? " Add the first one below." : ""}</p> : null}
      {adder}
      {ordered.length === 0 ? null : (
        <table aria-label="Item types, in order" className={`mt-4 ${dataTable}`}>
          <thead>
            <tr>
              <th scope="col" className={dataThCol}>Name</th>
              <th scope="col" className={dataThCol}>Code</th>
              <th scope="col" className={dataThCol}>Can be used</th>
              <th scope="col" className={dataThCol}>Position</th>
              <th scope="col" className={dataThCol}>Lowest price</th>
              <th scope="col" className={dataThCol}>Highest price</th>
              {editor ? <th scope="col" className={dataThCol}>Edit</th> : null}
            </tr>
          </thead>
          <tbody>
            {ordered.map((type) => (
              <Fragment key={type.id}>
                <tr className={dataTrGrid}>
                  <th scope="row" className={`${dataThRowWide} ${plainText}`}>
                    {type.name}
                  </th>
                  <td data-label="Code" className={`${dataTdStack} ${plainText}`}>
                    {type.code}
                  </td>
                  <td data-label="Can be used" className={dataTdStack}>{type.active ? "Yes" : "No, switched off"}</td>
                  <td data-label="Position" className={dataTdStack}>{type.position}</td>
                  <td data-label="Lowest price" className={dataTdStack}>{price(type.min_price_paise)}</td>
                  <td data-label="Highest price" className={dataTdStack}>{price(type.max_price_paise)}</td>
                  {editor ? (
                    <td className={dataTdEditWide}>
                      <details>
                        <summary className={summaryLine}>Edit {type.name}</summary>
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
