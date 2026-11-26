import { Calculator, CalendarDays, FileSpreadsheet, Mail, MessageCircle, Upload, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ADMINS } from "@/components/v2/app/nav";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { btnMain, pageMain } from "@/components/v2/app/ui";
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

/** The card of a "connect something" grid (a THING you connect = a card): one border, light radius, bare category icon left of the title, text left, one button. */
const card = "flex h-full min-w-0 flex-col items-start gap-2 rounded-xl border border-line bg-surface p-[18px] text-left";

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
      <ul className="mt-5 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3" data-part="source-grid">
        <li className={card} data-first="1">
          <div className="flex w-full min-w-0 items-center gap-3">
            <FileSpreadsheet data-k="find" className="size-6 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            <h2 className="min-w-0 text-[17px] font-semibold leading-snug text-ink">{t("integrations.pricelist.title")}</h2>
          </div>
          <p className="m-0 text-[15px] leading-snug text-muted">{t("integrations.pricelist.body")}</p>
          <p className="m-0 flex items-center gap-2 text-sm text-muted"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-green-text" />{t("integrations.available")}</p>
          <Link href={`/app/tenants/${tenantId}/price-list`} className={`${btnMain} mt-1 gap-2 self-start`}>
            <Upload className="size-5" aria-hidden="true" />
            {t("integrations.pricelist.cta")}
          </Link>
        </li>
        {AVAILABLE.map(({ key, icon: Icon, href, cta }) => (
          <li key={key} className={card}>
            <div className="flex w-full min-w-0 items-center gap-3">
              <Icon data-k={key === "whatsapp" ? "chat" : "find"} className="size-6 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <h2 className="min-w-0 text-[17px] font-semibold leading-snug text-ink">{t(`integrations.${key}.title` as "integrations.email.title")}</h2>
            </div>
            <p className="m-0 text-[15px] leading-snug text-muted">{t(`integrations.${key}.body` as "integrations.email.body")}</p>
            <p className="m-0 flex items-center gap-2 text-sm text-muted"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-green-text" />{t("integrations.available")}</p>
            <Link href={href(`/app/tenants/${tenantId}`)} className={`${btnMain} mt-1 gap-2 self-start`}>
              {t(cta as "integrations.whatsapp.cta")}
            </Link>
          </li>
        ))}
        {OTHERS.map(({ key, icon: Icon }) => (
          <li key={key} className={card}>
            <div className="flex w-full min-w-0 items-center gap-3">
              <Icon data-k="find" className="size-6 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <h2 className="min-w-0 text-[17px] font-semibold leading-snug text-ink">{t(`integrations.${key}.title` as "integrations.email.title")}</h2>
            </div>
            <p className="m-0 text-[15px] leading-snug text-muted">{t(`integrations.${key}.body` as "integrations.email.body")}</p>
            <p className="m-0 text-sm text-muted">{t("frame.notyet")}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
