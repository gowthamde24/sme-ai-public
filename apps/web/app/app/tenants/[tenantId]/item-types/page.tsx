import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchItemTypes, type ItemType } from "@/lib/api/item-types";
import { requireUser } from "@/lib/auth/session";

import { ApiDownV2, CatalogueTabs } from "@/components/v2/app/parts";
import { AddButton } from "@/components/v2/app/AddButton";
import { link, mutedText, noteBox, pageH1, pageMain, spaceTop } from "@/components/v2/app/ui";
import { EditItemTypeForm, AddItemTypeForm } from "./item-type-forms";
import { addItemTypeAction, saveItemTypeAction } from "./item-types-actions";
import { ItemTypesView } from "./item-types-view";

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
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
  }
  if (!READ_ROLES.includes(tenant.role))
    return (
      <main className={pageMain}>
        <h1 className={pageH1}>Item types</h1>
        <p className={mutedText}>Item types are shown to owners, admins and sales users.</p>
      </main>
    );

  let types: ItemType[];
  try {
    types = await fetchItemTypes(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return <ApiDownV2 />;
  }
  const canEdit = EDIT_ROLES.includes(tenant.role);
  const secondFactor = user.aal === "aal2";
  const note =
    canEdit && !secondFactor ? (
      <p role="note" className={noteBox}>
        Changing item types needs your authenticator app.{" "}
        <Link href="/app/security" className={link}>
          Set it up on the Security page
        </Link>
        , then sign in again with its code.
      </p>
    ) : null;
  const edit = canEdit && secondFactor;
  return (
    <main className={pageMain}>
      <ItemTypesView
        tabs={<CatalogueTabs tenantId={tenantId} role={tenant.role} current="item-types" />}
        types={types}
        adder={
          edit ? (
            <div className={spaceTop}>
              <AddButton label="Add an item type">
                <AddItemTypeForm add={addItemTypeAction.bind(null, tenantId)} />
              </AddButton>
            </div>
          ) : canEdit ? null : (
            <p className={mutedText}>Only an owner or an admin can add or change item types.</p>
          )
        }
        editor={
          edit
            ? (type) => (
                <EditItemTypeForm
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
