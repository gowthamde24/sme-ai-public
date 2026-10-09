import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchQuestionDrafts, type QuestionDraft } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { syncQuestionsAction } from "../../../followups/followup-actions";
import { FOLLOWUP_ROLES, NOTHING_SENT } from "../../../followups/page-parts";
import { ApiDownV2, NoticeV2, NotShownV2 } from "@/components/v2/app/parts";
import { SyncQuestionsForm } from "../../../followups/question-forms";
import { QuestionsView } from "../../../followups/questions-view";
import { pageMain } from "@/components/v2/app/ui";

export const metadata = { title: "Questions · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/requirements/[requirementId]/questions: the stored clarifying questions of a requirement. A Viewer sees nothing. Unknown ids produce the SAME not-found page. */
export default async function QuestionsPage({ params }: PageProps<"/app/tenants/[tenantId]/requirements/[requirementId]/questions">) {
  const user = await requireUser();
  const { tenantId, requirementId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requirementId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
  }
  if (!FOLLOWUP_ROLES.includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title="Questions for the customer" message="Follow-ups are shown to owners, admins and sales users." />;

  let drafts: QuestionDraft[];
  try {
    drafts = await fetchQuestionDrafts(user.accessToken, tenantId, requirementId, false);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
  }
  return (
    <main className={pageMain}>
      <NoticeV2>{NOTHING_SENT}</NoticeV2>
      <QuestionsView tenantId={tenantId} requirementId={requirementId} drafts={drafts} sync={<SyncQuestionsForm action={syncQuestionsAction.bind(null, tenantId, requirementId)} />} />
    </main>
  );
}
