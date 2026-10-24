import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchPolicyVersions, type PolicyVersion } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { createPolicyAction } from "../followup-actions";
import { FOLLOWUP_ROLES, todayInIndia } from "../page-parts";
import { ApiDownV2, NoticeV2, NotShownV2 } from "@/components/v2/app/parts";
import { PolicyForm } from "../policy-form";
import { PolicyView } from "../policy-view";
import { backLink, mutedText, pageMain } from "@/components/v2/app/ui";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Follow-up policy · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/followups/policy: the policy versions; the Owner (with the authenticator app) publishes a new one. A Viewer sees nothing. */
export default async function PolicyPage({ params }: PageProps<"/app/tenants/[tenantId]/followups/policy">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["fu."]);
  const t = makeT(words);
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
  if (!FOLLOWUP_ROLES.includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("fu.the_follow_up_policy")} message={t("fu.follow_ups_are_shown_to_owners")} />;

  let versions: PolicyVersion[];
  try {
    versions = await fetchPolicyVersions(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const today = todayInIndia(new Date());
  const form =
    tenant.role === "owner" ? (
      <PolicyForm words={words} action={createPolicyAction.bind(null, tenantId)} policyId={crypto.randomUUID()} today={today} secondFactorMissing={user.aal !== "aal2"} />
    ) : (
      <p className={mutedText}>{t("fu.only_the_owner_publishes_a_policy")}</p>
    );
  return (
    <main className={pageMain} lang={lang}>
      <p>
        <Link href={`/app/tenants/${tenantId}/followups`} className={backLink}>{t("fu.follow_ups_due_2")}</Link>
      </p>
      <NoticeV2>{t("fu.nothing_sent")}</NoticeV2>
      <PolicyView words={words} versions={versions} today={today} form={form} />
    </main>
  );
}
