import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ADMINS } from "@/components/v2/app/nav";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain, tileCard } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { appV4, designV6 } from "@/lib/screens/flag";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { PhoneV6 } from "@/components/v2/app/phone/PhoneV6";
import { PhoneNumberPanel } from "@/components/v2/app/phone/PhoneNumberPanel";
import { readPhone } from "@/lib/phone-number/source";
import { menuTitle } from "../menu-title";
import { approveStepAction, releaseNumberAction, requestNumberAction } from "./actions";

export const metadata = { title: `Your business number · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/phone-number (sidebar v2, AI team > Phone number; Owner and Admin): the number the assistant calls customers from. There is no telephony yet (real calls stay off until the lawyer review and a registered
 * number), so the page says so honestly: "Not set up yet · coming soon". It shows no number, takes no input and connects nothing. The WhatsApp number is a different thing (Integrations > WhatsApp).
 */
export default async function PhoneNumberPage({ params }: PageProps<"/app/tenants/[tenantId]/phone-number">) {
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
  if (!(ADMINS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("phone.title")} message={t("int.admins_only")} />;
  const phone = await readPhone();
  // design system v6: plain-language cards (the status, then the test screen's own panel: Edit = the city, one main button)
  if (designV6()) {
    const base = `/app/tenants/${tenantId}`;
    return (
      <PhoneV6
        words={wordsFor(lang, ["phv6.", "phone."], ["today.act.cancel"])}
        lang={lang}
        title={await menuTitle("phone", lang, user.accessToken, tenantId)}
        help={helpTipFor(lang, base, "phone", true)}
        phone={phone.mode === "ok" ? phone.data : null}
        panel={
          phone.mode === "ok" ? (
            <PhoneNumberPanel words={wordsFor(lang, ["phone."], ["today.act.cancel"])} initial={phone.data} canEdit={tenant.role === "owner"} mock={phone.mock} actions={{ request: requestNumberAction.bind(null, tenantId), approve: approveStepAction.bind(null, tenantId), release: releaseNumberAction.bind(null, tenantId) }} />
          ) : null
        }
        connectHref={`${base}/integrations`}
        voiceLink={
          appV4() && tenant.role === "owner" ? (
            <p className="mt-3 max-w-2xl text-base">
              <Link href={`${base}/settings?section=assistant#voice`} className="font-semibold text-brand-text underline-offset-4 hover:underline" data-part="change-voice">
                {t("tt.caller.link")}
              </Link>
            </p>
          ) : null
        }
      />
    );
  }
  return (
    <main className={pageMain}>
      <PageTop title={await menuTitle("phone", lang, user.accessToken, tenantId)} sub={`${t("phone.title")}. ${t("phone.sub")}`} />
      {phone.mode === "ok" ? (
        <PhoneNumberPanel
          words={wordsFor(lang, ["phone."], ["today.act.cancel"])}
          initial={phone.data}
          canEdit={tenant.role === "owner"}
          mock={phone.mock}
          actions={{ request: requestNumberAction.bind(null, tenantId), approve: approveStepAction.bind(null, tenantId), release: releaseNumberAction.bind(null, tenantId) }}
        />
      ) : (
        <section aria-labelledby="phone-status" data-part="phone-number" className={`${tileCard} max-w-2xl`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="phone-status" className="font-display text-xl font-semibold">
              {t("phone.status.title")}
            </h2>
            <span data-phone-state="not_set_up" className="rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold text-muted">
              {t("phone.status.none")}
            </span>
          </div>
          <p className="text-base text-muted">{t("phone.status.body")}</p>
        </section>
      )}
      {appV4() && tenant.role === "owner" ? (
        <p className="mt-3 max-w-2xl text-base">
          <Link href={`/app/tenants/${tenantId}/settings?section=assistant#voice`} className="font-semibold text-brand-text underline-offset-4 hover:underline" data-part="change-voice">
            {t("tt.caller.link")}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
