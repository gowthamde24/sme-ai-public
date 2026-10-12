import { notFound, redirect } from "next/navigation";

import { PartProblem } from "@/components/v2/app/cc/PartProblem";
import { ApiDownV2, PageTop } from "@/components/v2/app/parts";
import { InviteForm } from "@/components/v2/app/team/InviteForm";
import { Invitations } from "@/components/v2/app/team/Invitations";
import { TeamMembers } from "@/components/v2/app/team/TeamMembers";
import { pageMain } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { settle } from "@/lib/api/part";
import { getTeam, listInvitations } from "@/lib/api/team";
import { requireUser } from "@/lib/auth/session";

import { changeRoleAction, inviteAction, removeMemberAction, revokeInvitationAction } from "./actions";

export const metadata = { title: "Team · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/team (job CC): the people in the business with their owls and roles; for the Owner and Admin also the invitation form and the invitations. Everyone may see who is on the team and leave it; the
 * rest is the Owner's and Admin's (the API and the database decide again). Each part is read on its own and says 403, 429 or "not loaded" in its place.
 */
export default async function TeamPage({ params }: PageProps<"/app/tenants/[tenantId]/team">) {
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
  const admin = tenant.role === "owner" || tenant.role === "admin";
  let team, invitations;
  try {
    [team, invitations] = await Promise.all([settle(() => getTeam(user.accessToken, tenantId)), admin ? settle(() => listInvitations(user.accessToken, tenantId)) : null]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const words = wordsFor(lang, ["team.", "apierr.", "problem."], ["dta.btn.working", "dta.btn.copied", "dta.cal.copy_failed"]);
  const actions = {
    invite: inviteAction.bind(null, tenantId),
    revoke: revokeInvitationAction.bind(null, tenantId),
    changeRole: changeRoleAction.bind(null, tenantId),
    remove: removeMemberAction.bind(null, tenantId),
  };
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={t("team.title")} sub={t("team.sub")} />
      <div className="mt-6 flex max-w-3xl flex-col gap-5">
        {team.ok ? <TeamMembers words={words} members={team.data.members} myRole={tenant.role} actions={actions} /> : <PartProblem kind={team.kind} retryAfter={team.retryAfter} words={words} title={t("team.members.title")} />}
        {admin ? <InviteForm words={words} myRole={tenant.role} workspaceName={tenant.name} actions={actions} /> : null}
        {invitations ? invitations.ok ? <Invitations words={words} items={invitations.data} myRole={tenant.role} actions={actions} /> : <PartProblem kind={invitations.kind} retryAfter={invitations.retryAfter} words={words} title={t("team.inv.title")} /> : null}
      </div>
    </main>
  );
}
