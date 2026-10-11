import Link from "next/link";

import { OwlSvg } from "@/components/v2/app/owl/OwlSvg";
import { mutedText, notFoundBack, notFoundOwl, notFoundMain, notFoundRoot, notFoundTitle } from "@/components/v2/app/ui";
import { V2Root } from "@/components/v2/V2Root";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";

/**
 * The one not-found page. A tenant page the caller may not see, a tenant that does not exist and a
 * malformed id all end up here, so the response never reveals which of them it was. Drawn in the app's look,
 * with the owl and one way out, in the person's language.
 */
export default async function NotFound() {
  const lang = await getLang();
  const t = appT(lang);
  return (
    <V2Root lang={lang} className={notFoundRoot}>
      <main className={notFoundMain}>
        <OwlSvg agent="main" mood="idle" still className={notFoundOwl} />
        <h1 className={notFoundTitle}>{t("notfound.title")}</h1>
        <p className={mutedText}>{t("notfound.body")}</p>
        <Link href="/app" className={notFoundBack}>
          {t("notfound.back")}
        </Link>
      </main>
    </V2Root>
  );
}
