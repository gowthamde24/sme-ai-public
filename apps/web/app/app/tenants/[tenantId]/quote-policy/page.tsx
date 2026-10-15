import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchQuotePolicyVersions, type QuotePolicyVersion } from "@/lib/api/quote-policies";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";
import { MaterialPolicyPage } from "./material-policy-page";

import { ApiDownV2, CatalogueTabs } from "@/components/v2/app/parts";
import { AddButton } from "@/components/v2/app/AddButton";
import { link, mutedText, noteBox, pageH1, pageMain, spaceTop } from "@/components/v2/app/ui";

import { todayInIndia } from "../followups/page-parts";
import { publishQuotePolicyAction } from "./quote-policy-actions";
import { QuotePolicyForm } from "./quote-policy-form";
import { QuotePolicyView } from "./quote-policy-view";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Quote policy · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ROLES = ["owner", "admin"];

/**
 * /app/tenants/[tenantId]/quote-policy: the published quote policy versions, and (for an owner or an admin, with the authenticator app) a form to publish a new one. Every other role gets one plain
 * sentence and nothing else: no list and no form. The page makes ONE new id per render for the form.
 */
export default async function QuotePolicyPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/quote-policy">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["qp."]);
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
  // a business that sells by area, weight or piece (module `materials`, job CO) has its own rules: wastage, freight, loading, laying, advance, credit days, validity
  if (hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "materials")) {
    const query = await searchParams;
    return MaterialPolicyPage({ accessToken: user.accessToken, tenantId, role: tenant.role, aal2: user.aal === "aal2", lang, saved: (Array.isArray(query.saved) ? query.saved[0] : query.saved) === "1" });
  }
  if (!ROLES.includes(tenant.role))
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("qp.the_quote_policy")}</h1>
        <p className={mutedText}>{t("qp.only_an_owner_or_an_admin")}</p>
      </main>
    );

  let versions: QuotePolicyVersion[];
  try {
    versions = await fetchQuotePolicyVersions(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const today = todayInIndia(new Date());
  // A new version cannot start before today or before the newest published version (the database decides again).
  const newest = versions.reduce((latest, v) => (v.effective_from > latest ? v.effective_from : latest), "");
  const minDate = newest > today ? newest : today;
  const form =
    user.aal !== "aal2" ? (
      <p role="note" className={noteBox}>
        {t("qp.mfa_publishing")}{" "}
        <Link href="/app/security" className={link}>
          {t("qp.set_it_up_on_the_security")}
        </Link>
        {t("qp.mfa_b")}
      </p>
    ) : (
      <div className={spaceTop}>
        <AddButton label={t("qp.publish_a_new_version")}>
          <QuotePolicyForm action={publishQuotePolicyAction.bind(null, tenantId)} policyId={crypto.randomUUID()} today={today} minDate={minDate} />
        </AddButton>
      </div>
    );
  return (
    <main className={pageMain} lang={lang}>
      <QuotePolicyView words={words} tabs={<CatalogueTabs tenantId={tenantId} role={tenant.role} current="quote-policy" />} versions={versions} today={today} form={form} />
    </main>
  );
}
