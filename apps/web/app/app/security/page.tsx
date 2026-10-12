
import { bodyText, mutedText, okBox, pageH1, pageH2, pageMain, surface } from "@/components/v2/app/ui";
import { requireUser } from "@/lib/auth/session";

import { EnrolForm, RemoveForm } from "./security-forms";
import { Rich } from "@/components/v2/app/rich";
import { makeT } from "@/components/v2/app/words";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Security · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/**
 * /app/security: the second factor. Owners and Admins need an authenticator to erase data, export, change members or roles, and
 * change workspace settings (ADR 0016); everyone may have one. requireUser() runs first.
 */
export default async function SecurityPage({ searchParams }: PageProps<"/app/security">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["acct."]);
  const t = makeT(words);
  const user = await requireUser();
  const params = await searchParams;
  const done = params.done !== undefined;
  const removed = params.removed !== undefined;

  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{t("acct.security")}</h1>
      <p className={bodyText}>
        <Rich t={t} k="acct.signed_in_session" vars={{ email: user.email ?? t("acct.your_account") }} with={{ state: <strong>{user.aal === "aal2" ? t("acct.verified_with_your_authenticator") : t("acct.password_only")}</strong> }} />
      </p>
      {done && <p role="status" className={okBox}>{t("acct.done_your_authenticator_is_on")}</p>}
      {removed && <p role="status" className={okBox}>{t("acct.your_authenticator_was_removed")}</p>}

      <section aria-labelledby="mfa-heading" className={`mt-6 ${surface}`}>
        <h2 id="mfa-heading" className={pageH2}>
          {t("acct.authenticator_app")}
        </h2>
        {user.hasSecondFactor ? (
          <>
            <p className={bodyText}>
              <strong>{t("acct.on")}</strong> {t("acct.on_line")}
            </p>
            <RemoveForm words={words} />
            <p className={mutedText}>
              {t("acct.if_you_remove_it_you_can")}
            </p>
          </>
        ) : (
          <>
            <p className={bodyText}>
              <strong>{t("acct.not_set_up")}</strong> {t("acct.not_set_up_line")}
            </p>
            <EnrolForm words={words} />
          </>
        )}
      </section>

      <section aria-labelledby="lost-heading" className={`mt-6 ${surface}`}>
        <h2 id="lost-heading" className={pageH2}>
          {t("acct.if_you_lose_your_phone")}
        </h2>
        <p className={bodyText}>
          {t("acct.there_are_no_backup_codes_ask")}
        </p>
      </section>
    </main>
  );
}
