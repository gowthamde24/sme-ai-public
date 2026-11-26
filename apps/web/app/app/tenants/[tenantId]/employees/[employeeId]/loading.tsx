import { Skeleton } from "@/components/v2/app/ds/Skeleton";
import { pageMain } from "@/components/v2/app/ui";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

/** One AI employee while it loads: the name line and the tabs are grey blocks that breathe (opacity only). No spinner. */
export default async function EmployeeLoading() {
  const lang = await getLang();
  const words = wordsFor(lang, ["emp.page.loading"]);
  return (
    <main className={pageMain} lang={lang} aria-busy="true">
      <div role="status" aria-label={words["emp.page.loading"] ?? "Loading"} className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
    </main>
  );
}
