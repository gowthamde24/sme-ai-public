import Link from "next/link";

import { EmailAddress } from "@/components/v2/site/EmailAddress";
import { emailWords } from "@/components/v2/site/email-words";
import { authH1, authHint, authLead, authLink, authMain } from "@/components/v2/auth/ui";
import type { Lang } from "@/i18n/lang";
import { siteT } from "@/i18n/site";
import { signupT } from "@/i18n/signup";
import { ADDRESSES } from "@/lib/site/business";

/**
 * /signup while public sign-up is closed (job DH, lib/auth/signup-open.ts): a friendly note instead of a form that cannot work, "Request early access" as the general address (selectable text with Copy, mailto only as an
 * extra; no form and nothing stored, so no consent record is needed), and the way back to sign-in. No business cards, no e-mail form, no Google or Facebook button.
 */
export function SignupClosed({ lang }: { lang: Lang }) {
  const t = signupT(lang);
  return (
    <main id="main" className={authMain} lang={lang} data-signup="closed">
      <h1 className={authH1}>{t("signup.closed.title")}</h1>
      <p className={authLead}>{t("signup.closed.body")}</p>
      <section aria-labelledby="early-h" className="mb-4 flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-4">
        <h2 id="early-h" className="text-lg font-semibold">
          {t("signup.closed.early")}
        </h2>
        <p className="text-base text-muted">{t("signup.closed.write")}</p>
        <EmailAddress address={ADDRESSES.hello} words={emailWords(siteT(lang))} />
      </section>
      <p className={`${authHint} mt-2`}>
        {t("signup.have")}{" "}
        <Link href="/login" className={authLink}>
          {t("signup.signin")}
        </Link>
      </p>
    </main>
  );
}
