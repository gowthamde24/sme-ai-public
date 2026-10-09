import { notFound, redirect } from "next/navigation";

import { NAV, FOOT, type NavItem } from "@/components/v2/app/nav";
import { ApiDownV2, NotShownV2 } from "@/components/v2/app/parts";
import { bodyText, pageH1, pageMain, surface } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

/**
 * A screen of the new menu whose data layer has not landed yet: its title (the menu word), a role check like every page, and "Not available yet". It draws nothing
 * made up. Each batch of Job AC replaces one of these with the real screen; none is left when the job is done except where the report lists it.
 */
export async function StubPage({ params, item }: { params: Promise<{ tenantId: string }>; item: string }) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
  }
  const nav: NavItem | undefined = [...NAV.flatMap((g) => g.items), ...FOOT].find((i) => i.id === item);
  const lang = await getLang();
  const t = appT(lang);
  const title = t(`nav.item.${item}` as "nav.item.today");
  if (nav && !nav.roles.includes(tenant.role as never)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={title} message="Your role cannot open this page." />;
  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{title}</h1>
      <section className={`mt-6 ${surface}`}>
        <p className={bodyText}>{t("frame.notyet")}</p>
      </section>
    </main>
  );
}
