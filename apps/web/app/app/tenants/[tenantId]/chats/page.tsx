import { notFound, redirect } from "next/navigation";

import { PartProblem } from "@/components/v2/app/cc/PartProblem";
import { WRITERS } from "@/components/v2/app/nav";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { ChatList } from "@/components/v2/app/whatsapp/ChatList";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { settle } from "@/lib/api/part";
import { listConversations } from "@/lib/api/whatsapp";
import { requireUser } from "@/lib/auth/session";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Customer chats · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** The moment the page is drawn (ms), read once, so every "3h ago" on it agrees. */
const clock = (): number => Date.now();
const BEFORE = /^\d{4}-\d{2}-\d{2}T[0-9:.+Z-]{4,40}$/;

/**
 * /app/tenants/[tenantId]/chats (job CC): the customer chat inbox, newest first. For the Owner, Admin and Sales. A chat opens at /chats/[leadId]. "Older" follows the API's cursor (`?before=`, a time the API gave). Nothing here sends anything.
 */
export default async function ChatsPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/chats">) {
  const user = await requireUser();
  const { tenantId } = await params;
  const query = await searchParams;
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
  if (!(WRITERS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("wa.chats.title")} message={t("wa.chats.viewer")} />;
  const rawBefore = Array.isArray(query.before) ? query.before[0] : query.before;
  const before = rawBefore && BEFORE.test(rawBefore) ? rawBefore : null;
  let page;
  try {
    page = await settle(() => listConversations(user.accessToken, tenantId, { limit: 30, before }));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const words = wordsFor(lang, ["wa.", "apierr.", "problem."]);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={t("wa.chats.title")} sub={t("wa.chats.sub")} />
      <div className="mt-6 max-w-3xl">
        {page.ok ? (
          <ChatList tenantId={tenantId} words={words} page={page.data} now={clock()} olderHref={page.data.next_before ? `/app/tenants/${tenantId}/chats?before=${encodeURIComponent(page.data.next_before)}` : null} />
        ) : (
          <PartProblem kind={page.kind} retryAfter={page.retryAfter} words={words} title={t("wa.chats.title")} />
        )}
      </div>
    </main>
  );
}
