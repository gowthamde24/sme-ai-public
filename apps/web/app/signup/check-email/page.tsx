import Link from "next/link";

import { authH1, authLead, authLink, authMain, authParagraph } from "@/components/v2/auth/ui";
import { getLang } from "@/i18n/get-lang";
import { signupT } from "@/i18n/signup";

export const metadata = { title: "Check your email · SME AI Revenue Engine" };

/** Shown after a sign-up: the link was sent to the address given. It names no address (it is not in the URL) and promises nothing but what the link does. */
export default async function CheckEmailPage() {
  const lang = await getLang();
  const t = signupT(lang);
  return (
    <main id="main" className={authMain} lang={lang}>
      <h1 className={authH1}>{t("checkemail.title")}</h1>
      <p className={authLead}>{t("checkemail.body")}</p>
      <p className={authParagraph}>{t("checkemail.nothing")}</p>
      <p className={authParagraph}>
        <Link href="/login" className={authLink}>
          {t("checkemail.back")}
        </Link>
      </p>
    </main>
  );
}
