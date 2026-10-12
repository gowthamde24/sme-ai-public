import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchDueList, isDueCursor, type DueList } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { DueView } from "./due-view";
import { FOLLOWUP_ROLES } from "./page-parts";
import { ApiDownV2, LeadsTabs, NoticeV2, NotShownV2 } from "@/components/v2/app/parts";
import { link, pageMain } from "@/components/v2/app/ui";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Follow-ups due · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/followups: one page of the due list (`?after=` is the cursor of the previous page). A Viewer sees nothing and nothing is asked of the API for them. */
export default async function FollowupsPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/followups">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["fu."]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId } = await params;
  const query = await searchParams;
  const asked = Array.isArray(query.after) ? query.after[0] : query.after;
  const after = isDueCursor(asked) ? asked : undefined; // a cursor that is not ours is ignored: the first page
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
  if (!FOLLOWUP_ROLES.includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("fu.follow_ups_due")} message={t("fu.follow_ups_are_shown_to_owners")} />;

  let list: DueList;
  try {
    list = await fetchDueList(user.accessToken, tenantId, after);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  return (
    <main className={pageMain} lang={lang}>
      <p>
        <Link href={`/app/tenants/${tenantId}/followups/policy`} className={link}>
          {t("fu.the_follow_up_policy")}
        </Link>
      </p>
      <NoticeV2>{t("fu.nothing_sent")}</NoticeV2>
      <DueView words={words} tenantId={tenantId} list={list} tabs={<LeadsTabs tenantId={tenantId} role={tenant.role} current="followups" />} />
    </main>
  );
}
