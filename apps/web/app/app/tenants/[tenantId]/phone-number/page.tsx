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
import { readPhoneLines } from "@/lib/phone-lines/source";
import { callsPanel, phonePicker } from "@/lib/screens/flag";
import { requireUser } from "@/lib/auth/session";
import { PhoneNumberSimple } from "@/components/v2/app/phone/PhoneNumberSimple";
import { PhonePicker } from "@/components/v2/app/phone/LazyPhonePicker";
import { readNumber, readOwn } from "@/lib/phone-picker/source";
import { menuTitle } from "../menu-title";
import { claimNumberAction, ownNumberAction, searchNumbersAction } from "./picker-actions";

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
  // CALLS_PANEL + PHONE_LINES_SCREENS: "Calls at once" under the number (C1's GET /phone-lines); the card is not there when the flag is off
  const read = callsPanel() ? await readPhoneLines(user.accessToken, tenantId).catch((error) => (error instanceof ApiAuthError ? redirect("/login") : ({ mode: "unread" } as const))) : ({ mode: "off" } as const);
  const once =
    read.mode === "off" ? null : (
      <CallsAtOnce words={wordsFor(lang, ["cpn.once."])} lines={read.mode === "ok" ? read.lines : null} owner={tenant.role === "owner"} test={read.mode === "ok" && read.mock} />
    );
  // PHONE_PICKER (owner, 28 Nov 2026): the owner picks their own number from a list; the registration steps below stay for workspaces that are not on the picker
  if (phonePicker() !== "off") {
    const own = await readOwn(user.accessToken, tenantId);
    return (
      <main className={pageMain} lang={lang}>
        <PageTop title={await menuTitle("phone", lang, user.accessToken, tenantId)} sub={t("pick.sub")} />
        <div className="mt-4">
          <PhonePicker
            words={wordsFor(lang, ["pick."])}
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
