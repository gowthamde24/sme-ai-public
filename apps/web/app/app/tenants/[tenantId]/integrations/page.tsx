import { Calculator, CalendarDays, FileSpreadsheet, Mail, MessageCircle, Upload, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ADMINS } from "@/components/v2/app/nav";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { btnMain, pageMain, tileBadge, tileCard, tileGrid, tileIcon } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Integrations · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const OTHERS: { key: string; icon: LucideIcon }[] = [
  { key: "whatsapp", icon: MessageCircle },
  { key: "email", icon: Mail },
  { key: "upi", icon: Wallet },
  { key: "calendar", icon: CalendarDays },
  { key: "accounting", icon: Calculator },
];

/**
 * /app/tenants/[tenantId]/integrations (owner and admin): what could be connected. Only the price list import exists, and it goes to the price-list page; every other card says "Not available yet"
 * and what it would do. Nothing here connects, sends or charges anything.
 */
export default async function IntegrationsPage({ params }: PageProps<"/app/tenants/[tenantId]/integrations">) {
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
  const lang = await getLang();
  const t = appT(lang);
  if (!(ADMINS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("nav.item.integrations")} message="Integrations are shown to owners and admins." />;
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={t("nav.item.integrations")} sub={t("integrations.sub")} />
      <ul className={tileGrid}>
        <li className={tileCard}>
          <div className="flex items-start justify-between gap-3">
            <span className={`${tileIcon} bg-brand-bg text-brand-text`}>
              <FileSpreadsheet className="size-6" aria-hidden="true" />
            </span>
            <span className={`${tileBadge} border-green-text bg-green-bg text-green-text`}>{t("integrations.available")}</span>
          </div>
          <h2 className="mt-4 text-xl font-semibold">{t("integrations.pricelist.title")}</h2>
          <p className="mt-1 text-base text-muted">{t("integrations.pricelist.body")}</p>
          <Link href={`/app/tenants/${tenantId}/price-list`} className={`${btnMain} mt-4 w-full gap-2`}>
            <Upload className="size-5" aria-hidden="true" />
            {t("integrations.pricelist.cta")}
          </Link>
        </li>
        {OTHERS.map(({ key, icon: Icon }) => (
          <li key={key} className={tileCard}>
            <div className="flex items-start justify-between gap-3">
              <span className={tileIcon}>
                <Icon className="size-6" aria-hidden="true" />
              </span>
              <span className={`${tileBadge} border-line bg-surface-2 text-ink`}>{t("frame.notyet")}</span>
            </div>
            <h2 className="mt-4 text-xl font-semibold">{t(`integrations.${key}.title` as "integrations.email.title")}</h2>
            <p className="mt-1 text-base text-muted">{t(`integrations.${key}.body` as "integrations.email.body")}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
