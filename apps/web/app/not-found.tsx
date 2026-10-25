import { ProblemView } from "@/components/v2/app/robust/ProblemView";
import { notFoundMain, notFoundRoot } from "@/components/v2/app/ui";
import { V2Root } from "@/components/v2/V2Root";
import { getLang } from "@/i18n/get-lang";

/**
 * The one not-found page. A tenant page the caller may not see, a tenant that does not exist and a
 * malformed id all end up here, so the response never reveals which of them it was. Drawn in the app's look,
 * with the owl and one way out, in the person's language (the same friendly screen as the 403, 429 and 500 ones: job BW).
 */
export default async function NotFound() {
  const lang = await getLang();
  // job DH: loaded only when a 404 is really drawn. A static import here put the whole app dictionary (1.7 MB of server code) into the server graph of EVERY route, because Next includes the not-found page in each one, so a cold
  // render of /login or of a public page read and compiled it for nothing (measured in the job DH report).
  const { appDict } = await import("@/i18n/app");
  const dict = appDict(lang) as Record<string, string>;
  const labels = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("notfound.") || k.startsWith("problem.")));
  return (
    <V2Root lang={lang} className={notFoundRoot}>
      <ProblemView kind={404} labels={labels} className={notFoundMain} />
    </V2Root>
  );
}
