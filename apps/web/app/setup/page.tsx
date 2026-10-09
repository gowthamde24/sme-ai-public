import { redirect } from "next/navigation";

import { authH1, authLead, authMain } from "@/components/v2/auth/ui";
import { getLang } from "@/i18n/get-lang";
import { signupT } from "@/i18n/signup";
import { ApiAuthError } from "@/lib/api/client";
import { BUSINESS_TYPES, fetchAccountSetup, type AccountSetup } from "@/lib/api/account";
import { requireUser } from "@/lib/auth/session";

import { completeSetup } from "../app/setup/actions";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up your business · SME AI Revenue Engine" };
// A person's own screen: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /setup: the first-login set-up, in the look of the sign-in screens: the kind of business and the language, then Today. `/app` sends a confirmed account with no business here
 * (`fetchAccountSetup` says `needed`). The form calls the server action `completeSetup` (../app/setup/actions, Job AD), which makes the account's one business with the name given at sign-up.
 * Anyone it has nothing to do for (the business exists, or an invited person) is sent on to `/app`; if the state cannot be read the form is still shown (the action decides, again). A person
 * with no session is sent to sign in (requireUser).
 */
export default async function SetupPage() {
  const user = await requireUser();
  let state: AccountSetup["state"] | null = null;
  try {
    state = (await fetchAccountSetup(user.accessToken)).state;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    // the state could not be read: show the form; completing it is checked again by the database
  }
  if (state !== null && state !== "needed") redirect("/app");
  const lang = await getLang();
  const t = signupT(lang);
  return (
    <main id="main" className={authMain} lang={lang}>
      <h1 className={authH1}>{t("setup.title")}</h1>
      <p className={authLead}>{t("setup.sub")}</p>
      <SetupForm
        action={completeSetup}
        lang={lang}
        words={{ type: t("setup.type"), types: BUSINESS_TYPES.map((value) => ({ value, label: t(`setup.type.${value}` as "setup.type.other") })), language: t("setup.language"), submit: t("setup.submit"), error: t("setup.err.unknown") }}
      />
    </main>
  );
}
