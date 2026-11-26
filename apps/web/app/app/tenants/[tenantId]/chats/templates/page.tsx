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
import { readJobs } from "@/lib/api/jobs";
import { readOwnMessages } from "@/lib/api/template-builder";
import { listTemplates } from "@/lib/api/whatsapp";
import { requireUser } from "@/lib/auth/session";
import { BRAND_NAME } from "@/design/brand";
import { jobsScreens, templatesPlain } from "@/lib/screens/flag";

import { submitDraftsAction, submitTemplateAction, syncTemplatesAction } from "./actions";
import { submitOwnMessageAction, useOwnMessageAction, writeOwnMessageAction } from "./own-actions";

export const metadata = { title: `Templates · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";
/** The jobs that may send one of the shop's own messages (contract 1.1 part 1, A8). */
const SENDING: readonly string[] = ["offers", "followups", "store_visits"];

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
  // ONLY a 404 means "not there yet" (the part is then not drawn, quietly); any other refusal is said in that part's place
  const ownRead = jobs === "off" ? null : await settle(() => readOwnMessages(user.accessToken, tenantId));
  const own = ownRead?.ok ? ownRead.data : null;
  // "Use it in a job": the jobs that send offers, follow-ups or store visits (plain data: the choice is drawn inside the lazy chunk)
  const sending = own ? ((await readJobs(user.accessToken, tenantId).catch(() => null)) ?? []).filter((j) => SENDING.includes(j.kind)).map((j) => ({ id: j.id, kind: j.kind, customName: j.customName })) : [];
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={t(templatesPlain() ? "wa.tpl.plain.title" : "chats6.tab.templates")} sub={t("chats6.tab.templates.sub")} />
      <div className={`mt-6 flex flex-col gap-5 ${own ? "max-w-5xl" : "max-w-3xl"}`}>
        {ownRead && !ownRead.ok ? <PartProblem kind={ownRead.kind} retryAfter={ownRead.retryAfter} words={words} title={wordsFor(lang, ["jobs.tb.own.title"])["jobs.tb.own.title"]} /> : null}
        {own ? (
          <LazyOwnMessages
            words={wordsFor(lang, ["jobs.tb.", "jobs.kind."], ["today.err.generic"])}
            items={own}
            jobs={sending}
            actions={{ write: writeOwnMessageAction.bind(null, tenantId), submit: submitOwnMessageAction.bind(null, tenantId), use: useOwnMessageAction.bind(null, tenantId) }}
            secondFactor={user.hasSecondFactor}
            mock={jobs === "mock"}
            securityHref="/app/security"
            jobsHref={`/app/tenants/${tenantId}/jobs`}
            lang={lang}
            business={tenant.name}
          />
        ) : null}
        {own ? (
          // JOBS: the table of the messages Stack19 itself sends (their technical names, WhatsApp's review) is not the owner's page: it sits in a closed part that opens by itself when one of them is waiting for the admin or was refused
          <details data-part="system-messages" open={templates.ok ? templates.data.some((x) => x.status !== "approved") : true} className="rounded-xl border border-line bg-surface p-4">
            <summary className="cursor-pointer list-none text-[15px] font-semibold text-ink">
              {t("jobs.tb.system.title")}
              <span className="mt-1 block text-[13px] font-normal text-muted">{t("jobs.tb.system.sub")}</span>
            </summary>
            <div className="mt-4">{templates.ok ? (
              <TemplatesList plain={templatesPlain()} bare words={words} items={templates.data} actions={{ submitDrafts: submitDraftsAction.bind(null, tenantId), submitOne: submitTemplateAction.bind(null, tenantId), sync: syncTemplatesAction.bind(null, tenantId) }} />
            ) : (
              <PartProblem kind={templates.kind} retryAfter={templates.retryAfter} words={words} title={t("wa.tpl.title")} />
            )}</div>
          </details>
        ) : templates.ok ? (
          <TemplatesList plain={templatesPlain()} words={words} items={templates.data} actions={{ submitDrafts: submitDraftsAction.bind(null, tenantId), submitOne: submitTemplateAction.bind(null, tenantId), sync: syncTemplatesAction.bind(null, tenantId) }} />
        ) : (
          <PartProblem kind={templates.kind} retryAfter={templates.retryAfter} words={words} title={t("wa.tpl.title")} />
        )}
      </div>
    </main>
  );
}
