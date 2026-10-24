import Link from "next/link";

import type { Lang } from "@/i18n/lang";
import { legalT } from "@/i18n/legal";

import { sitePath } from "@/lib/site/paths";

import { CookieSettingsLink } from "./CookieSettingsLink";

const row = "inline-flex min-h-11 min-w-11 items-center rounded-md px-1 text-sm font-medium text-ink hover:underline";

/**
 * Privacy Policy, Terms, Data deletion, Contact (not in the public site's footer, which lists it already) and Cookie settings (jobs BH, DB): the legal links of every footer (landing page, sign-in and legal pages, the app). Words in the visitor's language; the pages they open are English.
 * `direction="column"` is the stacked list of the landing footer; the default is one row that wraps.
 */
export function LegalLinks({ lang, direction = "row", className, contact = true }: { lang: Lang; direction?: "row" | "column"; className?: string; contact?: boolean }) {
  const t = legalT(lang);
  return (
    <nav aria-label={t("legal.foot.label")} lang={lang} className={className}>
      <ul className={direction === "column" ? "flex flex-col" : "flex flex-wrap items-center gap-x-4"}>
        <li>
          <Link href="/privacy" className={row}>
            {t("legal.privacy.name")}
          </Link>
        </li>
        <li>
          <Link href="/terms" className={row}>
            {t("legal.terms.name")}
          </Link>
        </li>
        <li>
          <Link href="/data-deletion" className={row}>
            {t("legal.deletion.name")}
          </Link>
        </li>
        {contact ? (
          <li>
            <Link href={sitePath(lang, { kind: "page", page: "contact" })} className={row}>
              {t("legal.contact.name")}
            </Link>
          </li>
        ) : null}
        <li>
          <CookieSettingsLink label={t("legal.cookies.link")} className={row} />
        </li>
      </ul>
    </nav>
  );
}
