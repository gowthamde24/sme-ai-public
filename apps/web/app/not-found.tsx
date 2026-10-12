import { ProblemView } from "@/components/v2/app/robust/ProblemView";
import { notFoundMain, notFoundRoot } from "@/components/v2/app/ui";
import { V2Root } from "@/components/v2/V2Root";
import { appDict } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";

/**
 * The one not-found page. A tenant page the caller may not see, a tenant that does not exist and a
 * malformed id all end up here, so the response never reveals which of them it was. Drawn in the app's look,
 * with the owl and one way out, in the person's language (the same friendly screen as the 403, 429 and 500 ones: job BW).
 */
export default async function NotFound() {
  const lang = await getLang();
  const dict = appDict(lang) as Record<string, string>;
  const labels = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("notfound.") || k.startsWith("problem.")));
  return (
    <V2Root lang={lang} className={notFoundRoot}>
      <ProblemView kind={404} labels={labels} className={notFoundMain} />
    </V2Root>
  );
}
