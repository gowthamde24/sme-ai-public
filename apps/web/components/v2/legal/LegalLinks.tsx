import Link from "next/link";

import type { Lang } from "@/i18n/lang";
import { legalT } from "@/i18n/legal";

import { CookieSettingsLink } from "./CookieSettingsLink";

const row = "inline-flex min-h-11 min-w-11 items-center rounded-md px-1 text-sm font-medium text-ink hover:underline";

/**
 * Privacy Policy, Terms and Cookie settings (job BH): the legal links of every footer (landing page, sign-in and legal pages, the app). Words in the visitor's language; the pages they open are English.
 * `direction="column"` is the stacked list of the landing footer; the default is one row that wraps.
 */
export function LegalLinks({ lang, direction = "row", className }: { lang: Lang; direction?: "row" | "column"; className?: string }) {
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
          <CookieSettingsLink label={t("legal.cookies.link")} className={row} />
        </li>
      </ul>
    </nav>
  );
}
