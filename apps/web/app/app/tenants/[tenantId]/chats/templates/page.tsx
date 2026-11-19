import { notFound, redirect } from "next/navigation";

import { PartProblem } from "@/components/v2/app/cc/PartProblem";
import { ADMINS } from "@/components/v2/app/nav";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { OwnMessages as LazyOwnMessages } from "@/components/v2/app/whatsapp/builder/LazyOwnMessages";
import { TemplatesList } from "@/components/v2/app/whatsapp/TemplatesList";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { settle } from "@/lib/api/part";
import { readOwnMessages } from "@/lib/api/template-builder";
import { listTemplates } from "@/lib/api/whatsapp";
import { requireUser } from "@/lib/auth/session";
import { BRAND_NAME } from "@/design/brand";
import { jobsScreens } from "@/lib/screens/flag";

import { submitDraftsAction, submitTemplateAction, syncTemplatesAction } from "./actions";
import { submitOwnMessageAction, writeOwnMessageAction } from "./own-actions";

export const metadata = { title: `Templates · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/chats/templates: the third tab of Chats (owner, 16 Nov: moved out of the WhatsApp connection page). The WhatsApp message templates, the same table with "Send drafts to WhatsApp for review" and "Check WhatsApp's answer" (Owner and Admin; sending needs the second factor, which the API asks). The WhatsApp connection page keeps only the number.
 */
export default async function TemplatesPage({ params }: PageProps<"/app/tenants/[tenantId]/chats/templates">) {
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
  if (!(ADMINS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("chats6.tab.templates")} message={t("int.admins_only")} />;
  let templates;
  try {
    templates = await settle(() => listTemplates(user.accessToken, tenantId));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const words = wordsFor(lang, ["wa.", "apierr.", "problem.", "today.lang."], ["dta.btn.working"]);
  // JOBS: "Your own messages" (the builder with the checks) above the table; off = nothing here changes
  const jobs = jobsScreens();
  const own = jobs === "off" ? null : await readOwnMessages(user.accessToken, tenantId).catch(() => null);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={t("chats6.tab.templates")} sub={t("chats6.tab.templates.sub")} />
      <div className={`mt-6 flex flex-col gap-5 ${own ? "max-w-5xl" : "max-w-3xl"}`}>
        {own ? (
          <LazyOwnMessages
            words={wordsFor(lang, ["jobs.tb."], ["today.err.generic"])}
            items={own}
            actions={{ write: writeOwnMessageAction.bind(null, tenantId), submit: submitOwnMessageAction.bind(null, tenantId) }}
            secondFactor={user.hasSecondFactor}
            mock={jobs === "mock"}
            securityHref="/app/security"
            jobsHref={`/app/tenants/${tenantId}/jobs`}
            lang={lang}
            business={tenant.name}
          />
        ) : null}
        {templates.ok ? (
          <TemplatesList words={words} items={templates.data} actions={{ submitDrafts: submitDraftsAction.bind(null, tenantId), submitOne: submitTemplateAction.bind(null, tenantId), sync: syncTemplatesAction.bind(null, tenantId) }} />
        ) : (
          <PartProblem kind={templates.kind} retryAfter={templates.retryAfter} words={words} title={t("wa.tpl.title")} />
        )}
      </div>
    </main>
  );
}
