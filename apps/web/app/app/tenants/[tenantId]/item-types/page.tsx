import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchItemTypes, type ItemType } from "@/lib/api/item-types";
import { requireUser } from "@/lib/auth/session";
import { sendMaterialsBusinessTo } from "@/lib/packs/materials-redirect";

import { ApiDownV2, CatalogueTabs } from "@/components/v2/app/parts";
import { AddButton } from "@/components/v2/app/AddButton";
import { link, mutedText, noteBox, pageH1, pageMain, spaceTop } from "@/components/v2/app/ui";
import { EditItemTypeForm, AddItemTypeForm } from "./item-type-forms";
import { addItemTypeAction, saveItemTypeAction } from "./item-types-actions";
import { ItemTypesView } from "./item-types-view";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Item types · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const READ_ROLES = ["owner", "admin", "sales"];
const EDIT_ROLES = ["owner", "admin"];

/**
 * /app/tenants/[tenantId]/item-types: the workspace's item types. An owner or an admin (with the authenticator app, exactly as on the quote policy page) can add and change them; a sales
 * user reads the list and sees no control; a viewer gets one plain sentence and nothing is asked of the API. Every call goes to OUR API with the user's own token.
 */
export default async function ItemTypesPage({ params }: PageProps<"/app/tenants/[tenantId]/item-types">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["it.", "qp."]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  await sendMaterialsBusinessTo(user.accessToken, tenantId, "/quote-policy");

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (!READ_ROLES.includes(tenant.role))
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("it.item_types")}</h1>
        <p className={mutedText}>{t("it.item_types_are_shown_to_owners")}</p>
      </main>
    );

  let types: ItemType[];
  try {
    types = await fetchItemTypes(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const canEdit = EDIT_ROLES.includes(tenant.role);
  const secondFactor = user.aal === "aal2";
  const note =
    canEdit && !secondFactor ? (
      <p role="note" className={noteBox}>
        {t("it.mfa_changing")}{" "}
        <Link href="/app/security" className={link}>
          {t("it.set_it_up_on_the_security")}
        </Link>
        {t("it.mfa_b")}
      </p>
    ) : null;
  const edit = canEdit && secondFactor;
  return (
    <main className={pageMain} lang={lang}>
      <ItemTypesView words={words}
        tabs={<CatalogueTabs tenantId={tenantId} role={tenant.role} current="item-types" />}
        types={types}
        adder={
          edit ? (
            <div className={spaceTop}>
              <AddButton label={t("it.add_an_item_type")}>
                <AddItemTypeForm words={words} add={addItemTypeAction.bind(null, tenantId)} />
              </AddButton>
            </div>
          ) : canEdit ? null : (
            <p className={mutedText}>{t("it.only_an_owner_or_an_admin")}</p>
          )
        }
        editor={
          edit
            ? (type) => (
                <EditItemTypeForm words={words}
                  key={`${type.code}-${type.name}-${type.position}-${type.active}-${type.min_price_paise}-${type.max_price_paise}`}
                  type={type}
                  save={saveItemTypeAction.bind(null, tenantId, type.code)}
                />
              )
            : null
        }
      />
      {note}
    </main>
  );
}
