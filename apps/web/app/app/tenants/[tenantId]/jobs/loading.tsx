import { Skeleton } from "@/components/v2/app/ds/Skeleton";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

/** The Jobs page while it loads (JOBS; mock r3-07 D): the heading and its line are there at once, the chips and rows are grey blocks that breathe (opacity only; still for a person who asked for less motion). No spinner. */
export default async function JobsLoading() {
  const lang = await getLang();
  const words = wordsFor(lang, ["jobs.page."]);
  return (
    <main className={pageMain} lang={lang} aria-busy="true">
      <PageTop title={words["jobs.page.title"] ?? "Your AI team"} sub={words["jobs.page.sub"]} />
      <div data-part="jobs-skeleton" role="status" aria-label={words["jobs.page.loading"] ?? "Loading"} className="mt-4 flex flex-col gap-4">
        <div className="flex gap-2">
          {["w-20", "w-24", "w-28", "w-16"].map((w) => (
            <span key={w} aria-hidden="true" data-skeleton="" className={`jb-skeleton block h-9 rounded-full ${w}`} />
          ))}
        </div>
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-9 shrink-0 rounded-xl" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3.5 w-full" />
              </div>
              <Skeleton className="h-7 w-12 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
