import { Fragment, type ReactNode } from "react";

import type { ItemType } from "@/lib/api/item-types";
import { formatRupees } from "@/lib/api/quotes";

import { RANGE_SENTENCE, inListOrder } from "./item-types-logic";

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
      <h1 id="item-types-heading">Item types</h1>
      <p>Item types are the kinds of goods you quote, for example &quot;Type A&quot;. Each line of a quote with typed prices uses one.</p>
      <p className="hint">{RANGE_SENTENCE}</p>
      <p className="hint">Changing a price range does not change quotes that are already made.</p>
      {ordered.length === 0 ? (
        <p>No item types yet.{editor ? " Add the first one below." : ""}</p>
      ) : (
        <table aria-label="Item types, in order" className="data-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Code</th>
              <th scope="col">Can be used</th>
              <th scope="col">Position</th>
              <th scope="col">Lowest price</th>
              <th scope="col">Highest price</th>
              {editor ? <th scope="col">Edit</th> : null}
            </tr>
          </thead>
          <tbody>
            {ordered.map((type) => (
              <Fragment key={type.id}>
                <tr>
                  <th scope="row" className="plain-text">
                    {type.name}
                  </th>
                  <td data-label="Code" className="plain-text">
                    {type.code}
                  </td>
                  <td data-label="Can be used">{type.active ? "Yes" : "No, switched off"}</td>
                  <td data-label="Position">{type.position}</td>
                  <td data-label="Lowest price">{price(type.min_price_paise)}</td>
                  <td data-label="Highest price">{price(type.max_price_paise)}</td>
                  {editor ? (
                    <td className="edit-cell">
                      <details>
                        <summary className="tap">Edit {type.name}</summary>
                      </details>
                    </td>
                  ) : null}
                </tr>
                {editor ? (
                  <tr className="edit-row">
                    <td colSpan={7}>{editor(type)}</td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {adder}
    </section>
  );
}
