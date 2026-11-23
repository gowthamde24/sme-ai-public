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
import { appV4, designV6, jobsScreens, phoneSteps } from "@/lib/screens/flag";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { PhoneV6 } from "@/components/v2/app/phone/PhoneV6";
import { PhoneNumberPanel } from "@/components/v2/app/phone/PhoneNumberPanel";
import { KycCard } from "@/components/v2/app/phone/KycCard";
import { SecondStepNotice } from "@/components/v2/app/security/SecondStepNotice";
import { getAccountSecurity } from "@/lib/api/pack";
import { settle } from "@/lib/api/part";
import { getKycOptions, getKycStatus } from "@/lib/api/phone-kyc";
import { CAN_SEND } from "@/lib/phone-kyc/types";
import { readPhone } from "@/lib/phone-number/source";
import { menuTitle } from "../menu-title";
import { readIsDemo } from "../today-read";
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
  const kyc = await readKyc(user.accessToken, tenantId, tenant.role === "owner", t, lang, user.email);
  // design system v6: plain-language cards (the status, then the test screen's own panel: Edit = the city, one main button)
  if (designV6()) {
    const base = `/app/tenants/${tenantId}`;
    const isDemo = await readIsDemo(user.accessToken, tenantId, tenant.name);
    return (
      <PhoneV6
        words={wordsFor(lang, ["phv6.", "phone."], ["today.act.cancel"])}
        lang={lang}
        title={await menuTitle("phone", lang, user.accessToken, tenantId)}
        help={helpTipFor(lang, base, "phone", true)}
        phone={phone.mode === "ok" ? phone.data : null}
        panel={
          phone.mode === "ok" ? (
            <PhoneNumberPanel plain={phoneSteps()} words={wordsFor(lang, ["phone.", "phv6.", ...(jobsScreens() !== "off" ? ["jobs.pg.phone."] : [])], ["today.act.cancel"])} initial={phone.data} canEdit={tenant.role === "owner"} mock={phone.mock} single showMock={isDemo} simple={jobsScreens() !== "off"} actions={{ request: requestNumberAction.bind(null, tenantId), approve: approveStepAction.bind(null, tenantId), release: releaseNumberAction.bind(null, tenantId) }} />
          ) : null
        }
        connectHref={`${base}/integrations`}
        kyc={kyc}
      />
    );
  }
  return (
    <main className={pageMain}>
      <PageTop title={await menuTitle("phone", lang, user.accessToken, tenantId)} sub={`${t("phone.title")}. ${t("phone.sub")}`} />
      {kyc ? <div className="mt-4" data-part="kyc-slot">{kyc}</div> : null}
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

/**
 * The registration card of the Phone number page (not behind a flag: the API answers on its own when registration is not switched on). Everyone who sees the page reads where it stands; the Owner also reads the documents on offer (only while a filing can be sent) and the
 * session's level, for the second-step notice. A part that cannot be read leaves the page whole: the card then says "being set up".
 */
async function readKyc(token: string, tenantId: string, owner: boolean, t: ReturnType<typeof appT>, lang: Awaited<ReturnType<typeof getLang>>, email: string | null) {
  let status, security;
  try {
    [status, security] = await Promise.all([settle(() => getKycStatus(token, tenantId)), owner ? getAccountSecurity(token).catch(() => null) : Promise.resolve(null)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const current = status.ok ? status.data : null;
  let options = null;
  if (owner && current && CAN_SEND.has(current.state)) {
    const read = await settle(() => getKycOptions(token, tenantId));
    options = read.ok ? read.data : null;
  }
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {owner && security?.level === "aal1" && current && CAN_SEND.has(current.state) && options ? <SecondStepNotice message={t("phkyc.mfa")} t={t} /> : null}
      <KycCard steps={phoneSteps()} words={wordsFor(lang, ["phkyc.", "phsteps.", "apierr.", "ds.file."], ["dta.btn.working"])} status={current} options={options} canEdit={owner} defaultEmail={email ?? ""} endpoint={`/app/tenants/${tenantId}/phone-kyc`} />
    </div>
  );
}
