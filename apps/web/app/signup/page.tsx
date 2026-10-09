import { authH1, authLead, authMain } from "@/components/v2/auth/ui";
import { getLang } from "@/i18n/get-lang";
import { signupT } from "@/i18n/signup";
import { MIN_PASSWORD } from "@/lib/auth/password-policy";

import { SIGNUP_ERRORS } from "./contract";
import { SignUpForm } from "./sign-up-form";

export const metadata = { title: "Create your account · SME AI Revenue Engine" };

/**
 * /signup (Job AC, batch C5): the sign-up screen in the look of the sign-in screen. UI only: the form calls the server action `signUp` of Job AD when it exists. WIRING: when it lands, import it
 * here (`import { signUp } from "./actions"`) and pass it as `action={signUp}`; until then `action` is undefined and the form says "Not available yet" and cannot be sent.
 */
export default async function SignupPage() {
  const t = signupT(await getLang());
  const lang = await getLang();
  const errors: Record<string, string> = Object.fromEntries(SIGNUP_ERRORS.map((code) => [code, t(`signup.err.${code}` as "signup.err.required")]));
  errors.unknown = t("signup.err.unknown");
  return (
    <main id="main" className={authMain} lang={lang}>
      <h1 className={authH1}>{t("signup.title")}</h1>
      <p className={authLead}>{t("signup.sub")}</p>
      <SignUpForm
        action={undefined}
        words={{ name: t("signup.name"), email: t("signup.email"), password: t("signup.password"), passwordHint: t("signup.password.hint", { n: MIN_PASSWORD }), business: t("signup.business"), terms: t("signup.terms"), submit: t("signup.submit"), have: t("signup.have"), signin: t("signup.signin"), notAvailable: t("signup.notavailable"), errors }}
      />
    </main>
  );
}
