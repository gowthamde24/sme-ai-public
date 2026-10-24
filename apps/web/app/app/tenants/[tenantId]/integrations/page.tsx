import { Calculator, CalendarDays, FileSpreadsheet, Mail, MessageCircle, Upload, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ADMINS } from "@/components/v2/app/nav";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { btnMain, pageMain, tileBadge, tileCard, tileGrid, tileIcon } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { partsWords } from "@/i18n/app-words";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Integrations · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** The cards that are not built yet; every other card links to the screen that does it. */
const OTHERS: { key: string; icon: LucideIcon }[] = [{ key: "email", icon: Mail }, { key: "upi", icon: Wallet }];
/** The cards that open a screen: where it is, the word on the button and the icon (job CC: WhatsApp has its Connect page; the calendar and the accounting export are in Settings > Data). */
const AVAILABLE: { key: string; icon: LucideIcon; href: (base: string) => string; cta: string }[] = [
  { key: "whatsapp", icon: MessageCircle, href: (base) => `${base}/integrations/whatsapp`, cta: "integrations.whatsapp.cta" },
  { key: "calendar", icon: CalendarDays, href: (base) => `${base}/settings?section=data`, cta: "integrations.data.cta" },
  { key: "accounting", icon: Calculator, href: (base) => `${base}/settings?section=data`, cta: "integrations.data.cta" },
];

/**
 * /app/tenants/[tenantId]/integrations (owner and admin): what can be connected. The price list import goes to the price-list page, WhatsApp to its Connect page and the calendar and the accounting export to Settings > Data (job CC);
 * every other card says "Not available yet" and what it would do. Nothing here connects, sends or charges anything by itself.
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
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const t = appT(lang);
  if (!(ADMINS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("nav.item.integrations")} message={t("int.admins_only")} />;
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
        {AVAILABLE.map(({ key, icon: Icon, href, cta }) => (
          <li key={key} className={tileCard}>
            <div className="flex items-start justify-between gap-3">
              <span className={`${tileIcon} bg-brand-bg text-brand-text`}>
                <Icon className="size-6" aria-hidden="true" />
              </span>
              <span className={`${tileBadge} border-green-text bg-green-bg text-green-text`}>{t("integrations.available")}</span>
            </div>
            <h2 className="mt-4 text-xl font-semibold">{t(`integrations.${key}.title` as "integrations.email.title")}</h2>
            <p className="mt-1 text-base text-muted">{t(`integrations.${key}.body` as "integrations.email.body")}</p>
            <Link href={href(`/app/tenants/${tenantId}`)} className={`${btnMain} mt-4 w-full gap-2`}>
              <Icon className="size-5" aria-hidden="true" />
              {t(cta as "integrations.whatsapp.cta")}
            </Link>
          </li>
        ))}
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
