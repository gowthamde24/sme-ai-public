import { authH1, authLead, authMain } from "@/components/v2/auth/ui";
import { getLang } from "@/i18n/get-lang";
import { signupT } from "@/i18n/signup";
import { getCurrentPolicies, type CurrentPolicies } from "@/lib/api/policy";
import { SIGNUP_ERRORS } from "@/lib/api/signup";
import { MIN_PASSWORD } from "@/lib/auth/password-policy";

import { signUp } from "./actions";
import { SignUpForm } from "./sign-up-form";

export const metadata = { title: "Create your account · SME AI Revenue Engine" };

/**
 * /signup: the sign-up screen in the look of the sign-in screen. The form calls the server action `signUp` (./actions, Job AD): it ends on "check your email" for every well-formed
 * request, including an address that already has an account (nobody can learn which addresses have accounts). The four refusals it can give are SIGNUP_ERRORS of lib/api/signup.
 */
export default async function SignupPage() {
  const t = signupT(await getLang());
  const lang = await getLang();
  // the versions of the Terms and the Privacy Policy in force, sent with the sign-up so the acceptance is recorded (job CF); if they cannot be read the sign-up still works and the person is asked on the accept page
  const policyVersions: CurrentPolicies | null = await getCurrentPolicies().catch(() => null);
  const errors: Record<string, string> = Object.fromEntries(SIGNUP_ERRORS.map((code) => [code, t(`signup.err.${code}` as "signup.err.invalid", { n: MIN_PASSWORD })]));
  errors.unknown = t("signup.err.unknown");
  return (
    <main id="main" className={authMain} lang={lang}>
      <h1 className={authH1}>{t("signup.title")}</h1>
      <p className={authLead}>{t("signup.sub")}</p>
      <SignUpForm
        action={signUp}
        policyVersions={policyVersions ?? undefined}
        words={{ name: t("signup.name"), email: t("signup.email"), password: t("signup.password"), passwordHint: t("signup.password.hint", { n: MIN_PASSWORD }), business: t("signup.business"), terms: t("signup.terms"), termsLink: t("signup.terms.link"), privacyLink: t("signup.privacy.link"), submit: t("signup.submit"), have: t("signup.have"), signin: t("signup.signin"), errors }}
      />
    </main>
  );
}
