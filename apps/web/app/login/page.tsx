import Link from "next/link";

import { authH1, authHint, authMain, authSecondary } from "@/components/v2/auth/ui";
import { BRAND_NAME } from "@/design/brand";
import { getAuthProviders } from "@/lib/api/pack";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { turnstileSiteKey } from "@/lib/security/turnstile";

import { signInWithGoogle } from "./google-action";
import { LoginForm } from "./login-form";

export const metadata = { title: `Sign in · ${BRAND_NAME}` };

const NOTICES: Record<string, string> = {
  link: "That link has expired or was already used. Request a new one from \"Forgot your password?\".",
  reset: "Your password was changed. Sign in with the new one.",
  provider: "We could not sign you in with that provider. Try again, or use your e-mail address.",
  everywhere: "You were signed out of all devices. Sign in again here.",
  nosignup: "There is no account for that Google address, and sign-up is closed for now. Use the e-mail address your account was made with.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  // Validated here for display and again inside the server action; the form field is untrusted.
  const next = safeRedirectPath(raw);
  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  // Google is drawn only when the server says it is on (`GET /v1/auth/providers`); it signs existing people in, so it does not depend on the sign-up being open
  const providers = await getAuthProviders();

  return (
    <main id="main" className={authMain}>
      <h1 className={authH1}>Sign in</h1>
      <LoginForm next={next} notice={NOTICES[notice ?? ""]} turnstile={turnstileSiteKey()} />
      {providers.google ? (
        <form action={signInWithGoogle} className="flex flex-col" data-part="google-sign-in">
          <button type="submit" className={authSecondary}>
            Continue with Google
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
