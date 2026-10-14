import Link from "next/link";

import { EmailDisclosure } from "@/components/v2/auth/EmailDisclosure";
import { PackCard } from "@/components/v2/auth/PackCard";
import { PlushStill } from "@/components/v2/app/owl/PlushStill";
import { authAlert, authH1, authHint, authLead, authLink, authMain, authSecondary } from "@/components/v2/auth/ui";
import { getLang } from "@/i18n/get-lang";
import { signupT } from "@/i18n/signup";
import { getCurrentPolicies, type CurrentPolicies } from "@/lib/api/policy";
import { SIGNUP_ERRORS } from "@/lib/api/signup";
import { MIN_PASSWORD } from "@/lib/auth/password-policy";
import { parseSignupPack, signupCards } from "@/lib/packs/signup";

import { signUp } from "./actions";
import { continueWithProvider } from "./oauth-actions";
import { SignUpForm } from "./sign-up-form";

export const metadata = { title: "Create your account · SME AI Revenue Engine" };

/** A link inside a sentence (the terms line): inline text, underlined. */
const inlineLink = "font-semibold text-brand-text underline underline-offset-2";

function TermsLine({ text, termsLink, privacyLink }: { text: string; termsLink: string; privacyLink: string }) {
  return (
    <p className={`${authHint} text-center`} lang="en">
      {text.split(/(\{terms\}|\{privacy\})/).map((part, i) =>
        part === "{terms}" ? (
          <Link key={i} href="/terms" target="_blank" rel="noopener" className={inlineLink}>
            {termsLink}
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        ) : part === "{privacy}" ? (
          <Link key={i} href="/privacy" target="_blank" rel="noopener" className={inlineLink}>
            {privacyLink}
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/**
 * /signup, in two steps and nothing else (job CL, blueprint 3.1):
 *   1. "What kind of business do you run?": a card for each kind of business (the packs a person may pick), as plain links to `/signup?type=<id>`. No script.
 *   2. "Continue with Google / Facebook / e-mail", and the line "By continuing you agree to the Terms and the Privacy Policy". The e-mail way asks an address and a password only.
 * The kind of business is read from the address and checked against the packs (an unknown value shows step 1). Then the account goes straight to Today, laid out for the business type.
 * The e-mail way ends on "check your email" for every well-formed request (no account enumeration); its refusals are SIGNUP_ERRORS of lib/api/signup.
 */
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const lang = await getLang();
  const t = signupT(lang);
  const query = await searchParams;
  const type = parseSignupPack(query.type);
  const cards = signupCards(lang);

  if (!type) {
    return (
      <main id="main" className={authMain} lang={lang}>
        <p className="text-sm font-semibold text-muted">{t("signup.step", { n: 1 })}</p>
        <h1 className={authH1}>{t("signup.pack.title")}</h1>
        <p className={authLead}>{t("signup.pack.sub")}</p>
        <ul className="flex flex-col gap-3" aria-label={t("signup.pack.title")}>
          {cards.map((card) => (
            <li key={card.id}>
              <PackCard card={card} href={`/signup?type=${card.id}`} hint={t("signup.pack.choose", { name: card.name })} />
            </li>
          ))}
        </ul>
        <p className={`${authHint} mt-6`}>
          {t("signup.have")}{" "}
          <Link href="/login" className={authLink}>
            {t("signup.signin")}
          </Link>
        </p>
      </main>
    );
  }

  const chosen = cards.find((c) => c.id === type)!;
  // the versions of the Terms and the Privacy Policy in force, sent with the sign-up so the acceptance is recorded (job CF); if they cannot be read the sign-up still works and the person is asked on the accept page
  const policyVersions: CurrentPolicies | null = await getCurrentPolicies().catch(() => null);
  const errors: Record<string, string> = Object.fromEntries(SIGNUP_ERRORS.map((code) => [code, t(`signup.err.${code}` as "signup.err.invalid", { n: MIN_PASSWORD })]));
  errors.unknown = t("signup.err.unknown");
  const providerFailed = (Array.isArray(query.error) ? query.error[0] : query.error) === "provider";
  return (
    <main id="main" className={authMain} lang={lang}>
      <p className="text-sm font-semibold text-muted">{t("signup.step", { n: 2 })}</p>
      <h1 className={authH1}>{t("signup.title")}</h1>
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-2">
        <PlushStill px={40} agent="main" className="size-10" />
        <p className="min-w-0 flex-1 truncate text-base font-semibold" data-chosen-pack={type}>
          {chosen.name}
        </p>
        <Link href="/signup" className="inline-flex min-h-11 items-center text-base font-semibold text-brand-text hover:underline">
          {t("signup.pack.change")}
        </Link>
      </div>
      {providerFailed ? (
        <p role="alert" className={authAlert}>
          {t("signup.err.provider")}
        </p>
      ) : null}
      <form action={continueWithProvider} className="flex flex-col">
        <input type="hidden" name="type" value={type} />
        <button type="submit" name="provider" value="google" className={authSecondary}>
          {t("signup.google")}
        </button>
        <button type="submit" name="provider" value="facebook" className={authSecondary}>
          {t("signup.facebook")}
        </button>
      </form>
      <EmailDisclosure label={t("signup.email.cta")}>
        <SignUpForm
          action={signUp}
          businessType={type}
          policyVersions={policyVersions ?? undefined}
          words={{ email: t("signup.email"), password: t("signup.password"), passwordHint: t("signup.password.hint", { n: MIN_PASSWORD }), submit: t("signup.submit"), errors }}
        />
      </EmailDisclosure>
      <TermsLine text={t("signup.terms.continue")} termsLink={t("signup.terms.link")} privacyLink={t("signup.privacy.link")} />
      <p className={`${authHint} text-center`}>
        {t("signup.have")}{" "}
        <Link href="/login" className={authLink}>
          {t("signup.signin")}
        </Link>
      </p>
    </main>
  );
}
