import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchQuestionDrafts, type QuestionDraft } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { syncQuestionsAction } from "../../../followups/followup-actions";
import { ApiDown, FOLLOWUP_ROLES, Notice, NotShown } from "../../../followups/page-parts";
import { SyncQuestionsForm } from "../../../followups/question-forms";
import { QuestionsView } from "../../../followups/questions-view";

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
    return <ApiDown />;
  }
  if (!FOLLOWUP_ROLES.includes(tenant.role)) return <NotShown tenantId={tenantId} tenantName={tenant.name} title="Questions for the customer" />;

  let drafts: QuestionDraft[];
  try {
    drafts = await fetchQuestionDrafts(user.accessToken, tenantId, requirementId, false);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDown />;
  }
  return (
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}`}>← {tenant.name}</Link>
      </p>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <Notice />
      <QuestionsView tenantId={tenantId} requirementId={requirementId} drafts={drafts} sync={<SyncQuestionsForm action={syncQuestionsAction.bind(null, tenantId, requirementId)} />} />
    </main>
  );
}
