import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { DRAFT_CHANNELS, fetchLeadFollowup, type DraftChannel, type LeadFollowup } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { CreateDraftForm } from "../../../followups/create-draft-form";
import { createDraftAction, recordTouchAction } from "../../../followups/followup-actions";
import { indiaNowLocal } from "../../../followups/followup-logic";
import { LeadFollowupView } from "../../../followups/lead-followup-view";
import { FOLLOWUP_ROLES } from "../../../followups/page-parts";
import { ApiDownV2, NoticeV2, NotShownV2 } from "@/components/v2/app/parts";
import { TouchForm } from "../../../followups/touch-form";
import { backLink, link, pageMain } from "@/components/v2/app/ui";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Follow-up · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * /app/tenants/[tenantId]/leads/[leadId]/followup: one lead's follow-up. Server-side only; requireUser() runs FIRST and every call goes to OUR API with the user's own token. A Viewer sees nothing (and
 * nothing is asked of the API for them). Unknown, malformed and other workspaces' ids produce the SAME not-found page. The page records what a person did and shows closed draft text: it sends nothing.
 */
export default async function LeadFollowupPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/leads/[leadId]/followup">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["lead.", "fu."]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId, leadId } = await params;
  const query = await searchParams;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return (
      <ApiDownV2 words={await partsWords()} />
    );
  }
  if (!FOLLOWUP_ROLES.includes(tenant.role))
    return (
      <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("lead.follow_up")} message={t("lead.follow_ups_are_shown_to_owners")} />
    );

  // A channel in the address is honoured; anything else (or nothing) leaves the choice to the API, which answers for the lead's default channel and says which.
  const asked = pick(query.channel);
  const wanted: DraftChannel | undefined = (DRAFT_CHANNELS as readonly string[]).includes(asked ?? "") ? (asked as DraftChannel) : undefined;
  let data: LeadFollowup;
  try {
    data = await fetchLeadFollowup(user.accessToken, tenantId, leadId, wanted);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return (
      <ApiDownV2 words={await partsWords()} />
    );
  }

  const maxNow = indiaNowLocal(new Date());
  const ids = { sentTouchIds: Object.fromEntries(data.drafts.map((d) => [d.id, crypto.randomUUID()])), maxNow };
  // `key` makes a form start afresh when the tab changes (an uncontrolled field keeps its value while the same form stays mounted).
  const draftForm = <CreateDraftForm key={`draft-${data.channel}`} action={createDraftAction.bind(null, tenantId, leadId)} draftId={crypto.randomUUID()} channel={data.channel} />;
  const touchForm = <TouchForm key={`touch-${data.channel}`} action={recordTouchAction.bind(null, tenantId, leadId)} touchId={crypto.randomUUID()} maxNow={maxNow} channel={data.channel} />;
  return (
    <main className={pageMain} lang={lang}>
      <p>
        <Link href={`/app/tenants/${tenantId}/leads/${leadId}`} className={backLink}>{t("lead.lead")}</Link> · <Link href={`/app/tenants/${tenantId}/followups`} className={link}>{t("lead.follow_ups_due")}</Link>
      </p>
      <NoticeV2>{t("fu.nothing_sent")}</NoticeV2>
      <LeadFollowupView tenantId={tenantId} leadId={leadId} data={data} role={tenant.role} userId={user.id} aal={user.aal} ids={ids} draftForm={draftForm} touchForm={touchForm} />
    </main>
  );
}
