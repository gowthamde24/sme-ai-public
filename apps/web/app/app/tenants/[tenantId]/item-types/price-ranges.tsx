import Link from "next/link";
import { redirect } from "next/navigation";

import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { fetchItemTypes, type ItemType } from "@/lib/api/item-types";

import { AddButton } from "@/components/v2/app/AddButton";
import { link, mutedText, noteBox, spaceTop } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";
import { EditItemTypeForm, AddItemTypeForm } from "./item-type-forms";
import { addItemTypeAction, saveItemTypeAction } from "./item-types-actions";
import { ItemTypesView } from "./item-types-view";

const EDIT_ROLES = ["owner", "admin"];

/**
 * "Price ranges", the section under the price list (owner, 15 Nov 2026: the item types are no tab of their own): the workspace's item types with their optional lowest and highest price. An owner or an admin (with the
 * authenticator app, as on the quote policy) can add and change them; a sales user reads the list and sees no control. Server side only: every call goes to OUR API with the user's own token. A list that cannot be read says so
 * in one sentence in its place; the rest of the page stays.
 */
export async function PriceRanges({ accessToken, tenantId, role, secondFactorMissing, words }: { accessToken: string; tenantId: string; role: string; secondFactorMissing: boolean; words: Words }) {
  const t = makeT(words);
  let types: ItemType[];
  try {
    types = await fetchItemTypes(accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    return (
      <section id="price-ranges" className="scroll-mt-24">
        <p role="alert" className={noteBox}>
          {t("it.price_ranges_unavailable")}
        </p>
      </section>
    );
  }
  const canEdit = EDIT_ROLES.includes(role);
  const note =
    canEdit && secondFactorMissing ? (
      <p role="note" className={noteBox}>
        {t("it.mfa_changing")}{" "}
        <Link href="/app/security" className={link}>
          {t("it.set_it_up_on_the_security")}
        </Link>
        {t("it.mfa_b")}
      </p>
    ) : null;
  const edit = canEdit && !secondFactorMissing;
  return (
    <>
      <ItemTypesView
        words={words}
        types={types}
        adder={
          edit ? (
            <div className={spaceTop}>
              <AddButton label={t("it.add_an_item_type")}>
                <AddItemTypeForm words={words} add={addItemTypeAction.bind(null, tenantId)} />
              </AddButton>
              <p className={mutedText} data-part="saree-type-link">
                <Link href={`/app/tenants/${tenantId}/products/new`} className={link}>
                  {t("it.add_a_saree_type_link")}
                </Link>
              </p>
            </div>
          ) : canEdit ? null : (
            <p className={mutedText}>{t("it.only_an_owner_or_an_admin")}</p>
          )
        }
        editor={
          edit
            ? (type) => (
                <EditItemTypeForm
                  words={words}
                  key={`${type.code}-${type.name}-${type.position}-${type.active}-${type.min_price_paise}-${type.max_price_paise}`}
                  type={type}
                  save={saveItemTypeAction.bind(null, tenantId, type.code)}
                />
              )
            : null
        }
      />
      {note}
    </>
  );
}
