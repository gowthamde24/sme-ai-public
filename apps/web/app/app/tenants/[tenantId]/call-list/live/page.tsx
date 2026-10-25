import { notFound, redirect } from "next/navigation";

import { LiveCall } from "@/components/v2/app/call/LiveCall";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { LANGUAGE_NAMES } from "@/i18n/lang";
import { appT } from "@/i18n/app";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { MOCK_CALL } from "@/lib/calls/mock";
import { callScreens } from "@/lib/screens/flag";

export const metadata = { title: `Live call · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/call-list/live (job DM, from Call.dc.html): the live call screen. Behind CALL_SCREENS (off by default: the page is a 404). There is no telephony yet, so "mock" shows a PRETEND call and says so, and "1" says "Not
 * available yet" until the real call feed exists; a Viewer has no calls to listen to. Server side: requireUser runs first and the workspace is read with the person's own token.
 */
export default async function LiveCallPage({ params }: PageProps<"/app/tenants/[tenantId]/call-list/live">) {
  const mode = callScreens();
  if (mode === "off") notFound();
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role === "viewer") notFound();
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    throw error;
  }
  const lang = await getLang();
  const t = appT(lang);
  if (mode === "on")
    return (
      <main className={pageMain} lang={lang}>
        <p className="text-base text-muted">{t("frame.notyet")}</p>
      </main>
    );
  const words = wordsFor(lang, ["call."]);
  return (
    <main lang={lang}>
      <LiveCall words={words} call={{ ...MOCK_CALL, langName: LANGUAGE_NAMES[MOCK_CALL.lang].native }} backHref={`/app/tenants/${tenantId}`} testMode />
    </main>
  );
}
