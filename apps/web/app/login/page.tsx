import Link from "next/link";

import { authH1, authHint, authMain, authSecondary } from "@/components/v2/auth/ui";
import { BRAND_NAME } from "@/design/brand";
import { authLang, formWords, type FormWords } from "@/i18n/auth";
import { getAuthProviders } from "@/lib/api/pack";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { turnstileSiteKey } from "@/lib/security/turnstile";

import { signInWithGoogle } from "./google-action";
import { LoginForm } from "./login-form";

export const metadata = { title: `Sign in · ${BRAND_NAME}` };

const NOTICE_KEYS: Record<string, keyof FormWords> = { link: "form.notice.link", reset: "form.notice.reset", provider: "form.notice.provider", everywhere: "form.notice.everywhere", nosignup: "form.notice.nosignup" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  // Validated here for display and again inside the server action; the form field is untrusted.
  const next = safeRedirectPath(raw);
  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  // Google is drawn only when the server says it is on (`GET /v1/auth/providers`); it signs existing people in, so it does not depend on the sign-up being open
  const providers = await getAuthProviders();
  const w = formWords(await authLang());

  return (
    <main id="main" className={authMain}>
      <h1 className={authH1}>{w["form.signin.title"]}</h1>
      <LoginForm next={next} notice={NOTICE_KEYS[notice ?? ""] ? w[NOTICE_KEYS[notice ?? ""]] : undefined} turnstile={turnstileSiteKey()} words={{ email: w["form.email"], password: w["form.password"], submit: w["form.signin.submit"], forgot: w["form.forgot"] }} />
      {providers.google ? (
        <form action={signInWithGoogle} className="flex flex-col" data-part="google-sign-in">
          <button type="submit" className={authSecondary}>
            {w["form.google"]}
          </button>
        </form>
      ) : null}
      {/* the same line as the sign-up page (job DQ part 2): both links open in a new tab, so nobody loses the form */}
      <p className={`${authHint} text-center`} data-part="terms-line">
        By continuing, you agree to the{" "}
        <Link href="/terms" target="_blank" rel="noopener" className="font-semibold text-brand-text underline underline-offset-2">
          Terms
          <span className="sr-only"> (opens in a new tab)</span>
        </Link>{" "}
        and have read the{" "}
        <Link href="/privacy" target="_blank" rel="noopener" className="font-semibold text-brand-text underline underline-offset-2">
          Privacy notice
          <span className="sr-only"> (opens in a new tab)</span>
        </Link>
        .
      </p>
    </main>
  );
}
