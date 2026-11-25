import { notFound, redirect } from "next/navigation";

import { ADMINS } from "@/components/v2/app/nav";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { CallsAtOnce } from "@/components/v2/app/calls/panel/CallsAtOnce";
import { readExtraLines } from "@/lib/extra-lines/source";
import { readPhoneLines } from "@/lib/phone-lines/source";
import { tiles } from "@/lib/phone-lines/types";
import { callsPanel, extraLines, kycPerClient, phonePicker } from "@/lib/screens/flag";
import { requireUser } from "@/lib/auth/session";
import { PhoneNumberSimple } from "@/components/v2/app/phone/PhoneNumberSimple";
import { PhonePicker } from "@/components/v2/app/phone/LazyPhonePicker";
import { PhoneBuy } from "@/components/v2/app/phone/LazyPhoneBuy";
import { VerifyBusiness } from "@/components/v2/app/phone/LazyVerifyBusiness";
import { readStatus } from "@/lib/phone-kyc/source";
import { readNumber, readOwn } from "@/lib/phone-picker/source";
import { menuTitle } from "../menu-title";
import { addLineAction, cancelLineAction, keepLineAction } from "./lines-actions";
import { claimNumberAction, ownNumberAction, searchNumbersAction } from "./picker-actions";
import { buyNumberAction, kycAadhaarAction, kycDetailsAction, kycGstAction, kycPanAction, kycPinAction, kycStartAction, kycStatusAction, kycSubmitAction, searchAvailableAction } from "./kyc-actions";

export const metadata = { title: `Your business number · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";
const LOCALE: Record<string, string> = { en: "en-IN", te: "te-IN", hi: "hi-IN", kn: "kn-IN" };

/**
 * /app/tenants/[tenantId]/phone-number (sidebar v2, AI team > Phone number; Owner and Admin): the number the assistant calls customers from. There is no telephony yet (real calls stay off until the lawyer review and a registered
 * number), so the page says so honestly: "Not set up yet · coming soon". It shows no number, takes no input and connects nothing. The WhatsApp number is a different thing (Integrations > WhatsApp).
 */
export default async function PhoneNumberPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/phone-number">) {
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
  // CALLS_PANEL + PHONE_LINES_SCREENS: "Calls at once" under the number (C1's GET /phone-lines); the card is not there when the flag is off
  const read = callsPanel() ? await readPhoneLines(user.accessToken, tenantId).catch((error) => (error instanceof ApiAuthError ? redirect("/login") : ({ mode: "unread" } as const))) : ({ mode: "off" } as const);
  // EXTRA_LINES (26 Nov 2026): the Owner adds a line (the price shown first, paid from the credits) and cancels it; the total is the workspace's own (from the API; the test screen counts the lines it made up)
  const lines = extraLines() !== "off" && read.mode !== "off" && tenant.role === "owner" ? await readExtraLines(user.accessToken, tenantId).catch((error) => (error instanceof ApiAuthError ? redirect("/login") : ({ mode: "unread" } as const))) : ({ mode: "off" } as const);
  const extra =
    lines.mode === "ok"
      ? {
          overview: lines.data,
          actions: { add: addLineAction.bind(null, tenantId), cancel: cancelLineAction.bind(null, tenantId), keep: keepLineAction.bind(null, tenantId) },
          creditsHref: `/app/tenants/${tenantId}/billing`,
          locale: LOCALE[lang] ?? "en-IN",
          test: lines.mock,
        }
      : null;
  const shown = read.mode === "ok" ? (read.mock && lines.mode === "ok" && lines.mock ? tiles(lines.data.total, Math.min(1, lines.data.total)) : read.lines) : null;
  const once =
    read.mode === "off" ? null : (
      <CallsAtOnce words={wordsFor(lang, ["cpn.once.", "ln."])} lines={shown} owner={tenant.role === "owner"} test={read.mode === "ok" && read.mock} extra={extra} />
    );
  // PHONE_PICKER (owner, 28 Nov 2026): the owner picks their own number from a list; the registration steps below stay for workspaces that are not on the picker
  if (phonePicker() !== "off") {
    const own = await readOwn(user.accessToken, tenantId);
    // KYC_PER_CLIENT (owner, 29 Nov 2026; C1's Model B): with the picker, the business has its OWN account. No number yet = "Get a phone number" in four steps; a number (or an account started) that is not verified yet = "Verify your business". When the API
    // does not have the part (404) or the number is verified, the picker below is drawn as it was.
    const status = kycPerClient() !== "off" ? await readStatus(user.accessToken, tenantId) : null;
    if (status && !(own && status.state === "verified")) {
      const { verify, buy } = await searchParams;
      const here = `/app/tenants/${tenantId}/phone-number`;
      const mock = kycPerClient() === "mock" || phonePicker() === "mock";
      const showBuy = !own && (buy === "1" || (status.state === "not_started" && verify !== "1"));
      if (showBuy) {
        return (
          <main className={pageMain} lang={lang}>
            <PageTop title={t("pick.buy.title")} sub={t("pick.buy.sub")} />
            <div className="mt-4">
              <PhoneBuy
                words={wordsFor(lang, ["pick."])}
                canEdit={tenant.role === "owner"}
                email={user.email}
                mock={mock}
                verifyHref={`${here}?verify=1`}
                actions={{ search: searchAvailableAction.bind(null, tenantId), buy: buyNumberAction.bind(null, tenantId) }}
                kycFirst
                kyc={{
                  status,
                  actions: {
                    status: kycStatusAction.bind(null, tenantId),
                    start: kycStartAction.bind(null, tenantId),
                    details: kycDetailsAction.bind(null, tenantId),
                    pan: kycPanAction.bind(null, tenantId),
                    gst: kycGstAction.bind(null, tenantId),
                    aadhaar: kycAadhaarAction.bind(null, tenantId),
                    submit: kycSubmitAction.bind(null, tenantId),
                    pin: kycPinAction.bind(null, tenantId),
                    uploadUrl: `${here}/kyc-document`,
                  },
                }}
              />
            </div>
          </main>
        );
      }
      return (
        <main className={pageMain} lang={lang}>
          <PageTop title={t("pick.kyc.title")} sub={own ? `${own.display} · ${t(`pick.type.short.${own.type}` as "pick.type.short.mobile")}` : t("pick.kyc.sub.none")} />
          <div className="mt-4">
            <VerifyBusiness
              words={wordsFor(lang, ["pick."])}
              status={status}
              own={own}
              canEdit={tenant.role === "owner"}
              mock={mock}
              buyHref={`${here}?buy=1`}
              actions={{
                status: kycStatusAction.bind(null, tenantId),
                start: kycStartAction.bind(null, tenantId),
                details: kycDetailsAction.bind(null, tenantId),
                pan: kycPanAction.bind(null, tenantId),
                gst: kycGstAction.bind(null, tenantId),
                aadhaar: kycAadhaarAction.bind(null, tenantId),
                submit: kycSubmitAction.bind(null, tenantId),
                    pin: kycPinAction.bind(null, tenantId),
                uploadUrl: `${here}/kyc-document`,
              }}
            />
          </div>
        </main>
      );
    }
    return (
      <main className={pageMain} lang={lang}>
        <PageTop title={await menuTitle("phone", lang, user.accessToken, tenantId)} sub={t("pick.sub")} />
        <div className="mt-4">
          <PhonePicker
            words={wordsFor(lang, ["pick.", "phn.kyc."])}
            verifyHref={`/app/tenants/${tenantId}/phone-number?verify=1`}
            own={own}
            canEdit={tenant.role === "owner"}
            mock={phonePicker() === "mock"}
            actions={{ search: searchNumbersAction.bind(null, tenantId), claim: claimNumberAction.bind(null, tenantId), poll: ownNumberAction.bind(null, tenantId) }}
          />
        </div>
        {once}
      </main>
    );
  }
  // VoiceLink only (owner, 29 Nov 2026): no registration, no city to pick, no number to give back. The number the workspace has, or one line that we set it up.
  const own = await readNumber(user.accessToken, tenantId);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={await menuTitle("phone", lang, user.accessToken, tenantId)} sub={t("phn.sub")} />
      <PhoneNumberSimple words={wordsFor(lang, ["phn.", "pick.type.short."])} own={own} />
      {once}
    </main>
  );
}
