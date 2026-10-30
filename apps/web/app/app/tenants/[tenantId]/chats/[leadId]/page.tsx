import { notFound, redirect } from "next/navigation";

import { PartProblem } from "@/components/v2/app/cc/PartProblem";
import { WRITERS } from "@/components/v2/app/nav";
import { ApiDownV2, BackLink, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { ChatThread } from "@/components/v2/app/whatsapp/ChatThread";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getOutboxSettings } from "@/lib/api/outbox";
import { settle } from "@/lib/api/part";
import { getThread } from "@/lib/api/whatsapp";
import { requireUser } from "@/lib/auth/session";

import { approveChatMessageAction, markReadAction, refreshThreadAction, rejectChatMessageAction, replyAction } from "../actions";
import { BRAND_NAME } from "@/design/brand";
import { leadTitle } from "@/lib/lead-desk/leads";

export const metadata = { title: `Customer chat · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const clock = (): number => Date.now();

/**
 * /app/tenants/[tenantId]/chats/[leadId] (job CC): one customer's chat. The thread, the messages of ours with where each stands and why, the quiet-hours note (from the business's own quiet hours), a reply box, and for the owner and
 * admin the approve (= send) and decline buttons of a message that waits. The customer's number is not on the page.
 */
export default async function ChatPage({ params }: PageProps<"/app/tenants/[tenantId]/chats/[leadId]">) {
  const user = await requireUser();
  const { tenantId, leadId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) notFound();
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
  const back = { href: `/app/tenants/${tenantId}/chats`, label: t("wa.chats.title") };
  if (!(WRITERS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("wa.chats.title")} message={t("wa.chats.viewer")} />;
  let thread, settings;
  try {
    [thread, settings] = await Promise.all([settle(() => getThread(user.accessToken, tenantId, leadId)), settle(() => getOutboxSettings(user.accessToken, tenantId))]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  if (!thread.ok && thread.kind === "not_found") notFound();
  const words = wordsFor(lang, ["wa.", "apierr.", "problem.", "outbox.reason.", "today.lang."], ["dta.btn.working"]);
  return (
    <main className={pageMain} lang={lang}>
      <BackLink href={back.href} label={back.label} />
      <PageTop title={thread.ok ? leadTitle(thread.data.display_name ?? thread.data.name, null, t("wa.chats.customer")) : t("wa.chats.customer")} />
      <div className="mt-6 max-w-3xl">
        {thread.ok ? (
          <ChatThread
            words={words}
            thread={thread.data}
            role={tenant.role}
            quiet={settings.ok ? { start: settings.data.quiet_hours_start, end: settings.data.quiet_hours_end } : null}
            now={clock()}
            actions={{
              reply: replyAction.bind(null, tenantId, leadId),
              approve: approveChatMessageAction.bind(null, tenantId),
              reject: rejectChatMessageAction.bind(null, tenantId),
              refresh: refreshThreadAction.bind(null, tenantId, leadId),
              markRead: markReadAction.bind(null, tenantId, leadId),
            }}
          />
        ) : (
          <PartProblem kind={thread.kind} retryAfter={thread.retryAfter} words={words} title={t("wa.chats.title")} />
        )}
      </div>
    </main>
  );
}
