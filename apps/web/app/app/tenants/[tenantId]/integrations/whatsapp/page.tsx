import { notFound, redirect } from "next/navigation";

import { PartProblem } from "@/components/v2/app/cc/PartProblem";
import { ADMINS } from "@/components/v2/app/nav";
import { ApiDownV2, BackLink, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { ConnectWhatsapp } from "@/components/v2/app/whatsapp/ConnectWhatsapp";
import { TemplatesList } from "@/components/v2/app/whatsapp/TemplatesList";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { settle } from "@/lib/api/part";
import { getWhatsappAccount, listTemplates } from "@/lib/api/whatsapp";
import { requireUser } from "@/lib/auth/session";

import { activateWhatsappAction, disableWhatsappAction, saveWhatsappAction } from "./actions";

export const metadata = { title: "Connect WhatsApp · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/integrations/whatsapp (job CC): Connect WhatsApp. The Owner and Admin read the number's state (not connected, connecting, connected, needs attention) and the message templates; the Owner saves the
 * details and switches the number on and off (with the second factor). The access key is never on this page: only its name, and whether the server has it.
 */
export default async function ConnectWhatsappPage({ params }: PageProps<"/app/tenants/[tenantId]/integrations/whatsapp">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const t = appT(lang);
  if (!(ADMINS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("wa.title")} message={t("int.admins_only")} />;
  let account, templates;
  try {
    [account, templates] = await Promise.all([settle(() => getWhatsappAccount(user.accessToken, tenantId)), settle(() => listTemplates(user.accessToken, tenantId))]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    throw error;
  }
  const words = wordsFor(lang, ["wa.", "apierr.", "problem.", "today.lang."], ["dta.btn.working"]);
  return (
    <main className={pageMain} lang={lang}>
      <BackLink href={`/app/tenants/${tenantId}/integrations`} label={t("nav.item.integrations")} />
      <PageTop title={t("wa.title")} sub={t("wa.sub")} />
      <div className="mt-6 flex max-w-3xl flex-col gap-5">
        {account.ok ? (
          <ConnectWhatsapp
            words={words}
            account={account.data}
            canEdit={tenant.role === "owner"}
            actions={{ save: saveWhatsappAction.bind(null, tenantId), activate: activateWhatsappAction.bind(null, tenantId), disable: disableWhatsappAction.bind(null, tenantId) }}
          />
        ) : (
          <PartProblem kind={account.kind} retryAfter={account.retryAfter} words={words} title={t("wa.state.title")} />
        )}
        {templates.ok ? <TemplatesList words={words} items={templates.data} /> : <PartProblem kind={templates.kind} retryAfter={templates.retryAfter} words={words} title={t("wa.tpl.title")} />}
      </div>
    </main>
  );
}
