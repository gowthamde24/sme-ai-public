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
import { readActivation, usesChecklist } from "@/lib/packs/activation";
import { readDayOneActivation } from "@/lib/packs/day-one-activation";
import { leadDeskSteps } from "@/lib/packs/lead-activation";
import { readPackCached } from "@/lib/packs/read";

import { TypePicker } from "@/components/v2/app/start/TypePicker";
import { typeKeywords } from "@/lib/packs/type-search";
import { listPacks } from "@/lib/api/pack";
import { designV6, firstRunType } from "@/lib/screens/flag";

import { saveProfileAction, setPackAction } from "./actions";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Get started · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/start (job CL): the activation checklist of a business type and its first question, the business name and the city, asked here and nowhere else (blueprint 3.3, progressive profiling).
 * Only a workspace made with a chosen business type has this page (one that existed before, or was made without choosing, keeps the first-run wizard it always had: 404). Owner or Admin; anyone else sees a plain sentence. Server side;
 * requireUser() runs first and every call carries the person's own token.
 */
export default async function StartPage({ params }: PageProps<"/app/tenants/[tenantId]/start">) {
  const lang = await getLang();
  const t = appT(lang);
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  let role: string;
  let shop = "";
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    role = tenant.role;
    shop = tenant.name;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    throw error;
  }
  const pack = await readPackCached(user.accessToken, tenantId);
  if (!pack) notFound();
  // a workspace made WITHOUT a business type (FIRST_RUN_TYPE): ask once, then the page below is the chosen type's own
  if (!usesChecklist(pack) && !(firstRunType() && (role === "owner" || role === "admin"))) notFound();
  const base = `/app/tenants/${tenantId}`;
  if (role !== "owner" && role !== "admin") {
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("start.page.title")}</h1>
        <p className={bodyText}>{t("start.page.role")}</p>
      </main>
    );
  }
  if (!usesChecklist(pack)) {
    const packs = await listPacks().catch(() => []);
    const names = (p: (typeof packs)[number]) => p.names[lang] ?? p.names.en;
    const dict = appDict(lang) as Record<string, string>;
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("start.page.title")}</h1>
        <div className="mt-6 max-w-3xl">
          <TypePicker
            choices={packs.map((p) => ({ id: p.packId, name: names(p), line: p.summary[lang] ?? p.summary.en ?? "", keywords: typeKeywords(p) }))}
            words={Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("start.type.")))}
            save={setPackAction.bind(null, tenantId)}
          />
        </div>
      </main>
    );
  }
  let profile: BusinessProfile | null = null;
  try {
    profile = await getProfile(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
  }
  // ONE checklist: the seven steps of day one that Today counts ("Finish setup · 5 of 7"); the API's own list of six is only the fallback when the assistant's status cannot be read
  const dayOne = designV6() ? await readDayOneActivation({ token: user.accessToken, tenantId, shop: profile?.name || shop, modules: pack.modules, base, t }).catch(() => null) : null;
  const activation = dayOne ?? (await readActivation(user.accessToken, tenantId, pack, t, await leadDeskSteps(pack)));
  const dict = appDict(lang) as Record<string, string>;
  const words = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("start.")));
  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{t("start.page.title")}</h1>
      <p className={bodyText}>{t("start.page.sub")}</p>
      <div className="mt-6 grid max-w-3xl gap-6">
        <section className="rounded-xl border border-line bg-surface p-4 md:p-5">
          <h2 className="mb-3 font-display text-xl font-semibold leading-tight">{t("start.profile.title")}</h2>
          <ProfileStep action={saveProfileAction.bind(null, tenantId)} words={words} name={profile?.name ?? ""} town={profile?.town ?? ""} backHref={base} />
        </section>
        <ActivationCard activation={activation} base={base} t={t} />
      </div>
    </main>
  );
}
