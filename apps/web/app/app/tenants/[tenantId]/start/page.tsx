import { notFound, redirect } from "next/navigation";

import { ActivationCard } from "@/components/v2/app/start/ActivationCard";
import { ProfileStep } from "@/components/v2/app/start/ProfileStep";
import { bodyText, pageH1, pageMain } from "@/components/v2/app/ui";
import { appDict, appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getProfile, type BusinessProfile } from "@/lib/api/profile";
import { requireUser } from "@/lib/auth/session";
import { readActivation } from "@/lib/packs/activation";
import { readPackCached } from "@/lib/packs/read";

import { saveProfileAction } from "./actions";

export const metadata = { title: "Get started · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/start (job CL): the activation checklist of a business type and its first question, the business name and the city, asked here and nowhere else (blueprint 3.3, progressive profiling).
 * Only a business type whose pack has a checklist of its own has this page (the others keep the first-run wizard they always had: 404). Owner or Admin; anyone else sees a plain sentence. Server side;
 * requireUser() runs first and every call carries the person's own token.
 */
export default async function StartPage({ params }: PageProps<"/app/tenants/[tenantId]/start">) {
  const lang = await getLang();
  const t = appT(lang);
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    throw error;
  }
  const pack = await readPackCached(user.accessToken, tenantId);
  if (pack.def.activation.style !== "steps") notFound();
  const base = `/app/tenants/${tenantId}`;
  if (role !== "owner" && role !== "admin") {
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("start.page.title")}</h1>
        <p className={bodyText}>{t("start.page.role")}</p>
      </main>
    );
  }
  let profile: BusinessProfile | null = null;
  try {
    profile = await getProfile(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
  }
  const activation = await readActivation(user.accessToken, tenantId, pack.def, lang);
  const dict = appDict(lang) as Record<string, string>;
  const words = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("start.")));
  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{t("start.page.title")}</h1>
      <p className={bodyText}>{t("start.page.sub")}</p>
      <div className="mt-6 grid max-w-3xl gap-6">
        <section className="rounded-[20px] border border-line bg-surface p-4 md:p-5">
          <h2 className="mb-3 font-display text-xl font-semibold leading-tight">{t("start.profile.title")}</h2>
          <ProfileStep action={saveProfileAction.bind(null, tenantId)} words={words} name={profile?.name ?? ""} town={profile?.town ?? ""} backHref={base} />
        </section>
        <ActivationCard activation={activation} base={base} t={t} />
      </div>
    </main>
  );
}
