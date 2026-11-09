import { notFound, redirect } from "next/navigation";

import { EverythingView } from "@/components/v2/app/everything/EverythingView";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { readEverything } from "@/lib/everything/source";
import { appV4, assistantWorkScreens } from "@/lib/screens/flag";

import { menuTitle } from "../menu-title";

export const metadata = { title: `Everything it did · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/everything (app v4 part 8; the Owner's and Admin's): everything the assistant did in the last 7 days, in one timeline (see lib/everything). Only with APP_V4. */
export default async function EverythingPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!appV4() || !isCanonicalUuid(tenantId)) notFound();
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
  const title = await menuTitle("everything", lang, user.accessToken, tenantId);
  if (tenant.role !== "owner" && tenant.role !== "admin") return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={title} message={t("ev.owneronly")} />;
  let result;
  try {
    result = await readEverything({ token: user.accessToken, tenantId }, assistantWorkScreens(tenantId));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={title} sub={t("ev.sub")} />
      <EverythingView entries={result.entries} words={wordsFor(lang, ["ev."])} base={`/app/tenants/${tenantId}`} lang={lang} missing={result.missing} example={result.example} />
    </main>
  );
}
