import { getAccountSecurity } from "@/lib/api/pack";
import { SecondStepNotice } from "@/components/v2/app/security/SecondStepNotice";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PartProblem } from "@/components/v2/app/cc/PartProblem";
import { ADMINS } from "@/components/v2/app/nav";
import { ApiDownV2, BackLink, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { ConnectWhatsapp } from "@/components/v2/app/whatsapp/ConnectWhatsapp";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { settle } from "@/lib/api/part";
import { getConnectConfig, getWhatsappAccount } from "@/lib/api/whatsapp";
import { requireUser } from "@/lib/auth/session";

import { activateWhatsappAction, connectWithFacebookAction, disableWhatsappAction, disconnectWhatsappAction, saveWhatsappAction } from "./actions";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Connect WhatsApp · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/integrations/whatsapp (job CC): Connect WhatsApp. The Owner and Admin read the number's state (not connected, connecting, connected, needs attention); the message templates are on Chats, in the Templates tab (owner, 16 Nov); the Owner saves the
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
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const t = appT(lang);
  if (!(ADMINS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("wa.title")} message={t("int.admins_only")} />;
  let account, security, config;
  try {
    [account, security, config] = await Promise.all([settle(() => getWhatsappAccount(user.accessToken, tenantId)), getAccountSecurity(user.accessToken).catch(() => null), tenant.role === "owner" ? getConnectConfig(user.accessToken, tenantId) : Promise.resolve(null)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const words = wordsFor(lang, ["wa.", "apierr.", "problem.", "today.lang."], ["dta.btn.working"]);
  return (
    <main className={pageMain} lang={lang}>
      <BackLink href={`/app/tenants/${tenantId}/integrations`} label={t("nav.item.integrations")} />
      <PageTop title={t("wa.title")} sub={t("wa.sub")} />
      <div className="mt-6 flex max-w-3xl flex-col gap-5">
        {security?.level === "aal1" && security.neededFor.includes("whatsapp_connect") && tenant.role === "owner" ? <SecondStepNotice message={t("sec.notice.whatsapp")} t={t} /> : null}
        {account.ok ? (
          <ConnectWhatsapp
            words={words}
            account={account.data}
            canEdit={tenant.role === "owner"}
            signup={{ config, connect: connectWithFacebookAction.bind(null, tenantId) }}
            actions={{ save: saveWhatsappAction.bind(null, tenantId), activate: activateWhatsappAction.bind(null, tenantId), disable: disableWhatsappAction.bind(null, tenantId), disconnect: disconnectWhatsappAction.bind(null, tenantId) }}
          />
        ) : (
          <PartProblem kind={account.kind} retryAfter={account.retryAfter} words={words} title={t("wa.state.title")} />
        )}
        <p className="m-0 text-base text-muted" data-part="templates-moved">
          {t("wa.tpl.moved")}{" "}
          <Link href={`/app/tenants/${tenantId}/chats/templates`} className="font-semibold text-brand-text underline underline-offset-4">
            {t("wa.tpl.moved.link")}
          </Link>
        </p>
      </div>
    </main>
  );
}
