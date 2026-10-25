import Link from "next/link";

import type { AppT } from "@/i18n/app";

import { OrbMark } from "../mark/OrbMark";
import { backLink, bodyText, pageH1, pageMain } from "../ui";

/**
 * A part of the app that a business type has switched ON and that is not built yet (job CL: Fees for education, Campaigns for construction and education): the menu and the phone tab are in their place so the shell
 * is the one blueprint section 2 draws, and the page says plainly that the part is not available yet. It shows no number, no list and no button that does nothing; the screens come with the jobs that build them
 * (campaigns CQ, fees CS). `which` is "fees" or "campaigns".
 */
export function SoonPage({ which, base, lang, t }: { which: "fees" | "campaigns"; base: string; lang: string; t: AppT }) {
  return (
    <main className={pageMain} lang={lang} data-screen={`soon-${which}`}>
      <h1 className={pageH1}>{t(`soon.${which}.title` as "soon.fees.title")}</h1>
      <div className="mt-4 flex max-w-xl items-start gap-4 rounded-[20px] border border-line bg-surface p-4 md:p-5">
        <OrbMark px={72} className="size-[72px]" />
        <div className="min-w-0">
          <p className="font-semibold">{t("frame.notyet")}</p>
          <p className={bodyText}>{t(`soon.${which}.body` as "soon.fees.body")}</p>
          <p className="mt-3">
            <Link href={base} className={backLink}>
              {t("start.back")}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
