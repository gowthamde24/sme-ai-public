import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { addCustomerAction } from "./actions";
import { CustomerForm } from "./customer-form";
import { bodyText, mutedText, pageH1, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { makeT } from "@/components/v2/app/words";
import { appT } from "@/i18n/app";
import { formFields } from "@/lib/packs/form-fields";
import { listCustomFields } from "@/lib/api/custom-fields";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Add a customer · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const WRITERS = ["owner", "admin", "sales"];

/**
 * /app/tenants/[tenantId]/customers/new: add one customer (a contact with a phone, and a lead for it). Owner, Admin or Sales. Server-side; requireUser() runs FIRST and every call goes to OUR API with the
 * user's own token. Anyone else sees a plain notice and the API is not asked anything for them; the API and the database enforce the role regardless.
 */
export default async function NewCustomerPage({ params }: PageProps<"/app/tenants/[tenantId]/customers/new">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["cust."], ["gst.customer.optional", "gst.customer.hint"]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (!WRITERS.includes(tenant.role))
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("cust.add_a_customer")}</h1>
        <p className={bodyText}>{t("cust.an_owner_an_admin_or_a")}</p>
      </main>
    );
  // one set of ids per render: a second press of the button is a retry. The key remounts the form for the next customer, so its state starts clean.
  const ids = { company: crypto.randomUUID(), contact: crypto.randomUUID(), lead: crypto.randomUUID() };
  // the extra fields of the business (job CL): drawn only when the server can list them (a server without the field routes draws none, and nothing is pretended saved)
  const fields = formFields(await listCustomFields(user.accessToken, tenantId, "contact").catch((e) => (e instanceof ApiAuthError ? redirect("/login") : [])), "contact", lang);
  const a = appT(lang);
  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{t("cust.add_a_customer")}</h1>
      <p className={mutedText}>
        {t("cust.a_customer_is_a_person_with")}
      </p>
      <CustomerForm words={words} key={`${ids.company}|${ids.contact}|${ids.lead}`} action={addCustomerAction.bind(null, tenantId)} tenantId={tenantId} ids={ids} fields={fields} fieldWords={{ title: a("fields.form.title"), yes: a("fields.form.yes"), no: a("fields.form.no"), pick: a("fields.form.pick") }} />
    </main>
  );
}
