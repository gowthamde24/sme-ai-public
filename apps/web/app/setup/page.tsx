import { authH1, authLead, authMain } from "@/components/v2/auth/ui";
import { getLang } from "@/i18n/get-lang";
import { signupT } from "@/i18n/signup";
import { requireUser } from "@/lib/auth/session";

import { BUSINESS_TYPES } from "../signup/contract";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up your business · SME AI Revenue Engine" };
// A person's own screen: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /setup (Job AC, batch C5): the first-login set-up, in the look of the sign-in screens: the kind of business and the language, then Today. UI only: the form calls the server action
 * `completeSetup` of Job AD when it exists. WIRING: import it here and pass `action={completeSetup}`; until then the form says "Not available yet". Nothing sends a person here yet: that
 * redirect after the first sign-in is Job AD's. A person with no session is sent to sign in (requireUser).
 */
export default async function SetupPage() {
  await requireUser();
  const lang = await getLang();
  const t = signupT(lang);
  return (
    <main id="main" className={authMain} lang={lang}>
      <h1 className={authH1}>{t("setup.title")}</h1>
      <p className={authLead}>{t("setup.sub")}</p>
      <SetupForm
        action={undefined}
        lang={lang}
        words={{ type: t("setup.type"), types: BUSINESS_TYPES.map((value) => ({ value, label: t(`setup.type.${value}` as "setup.type.other") })), language: t("setup.language"), submit: t("setup.submit"), notAvailable: t("signup.notavailable"), error: t("setup.err.unknown") }}
      />
    </main>
  );
}
