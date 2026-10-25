import { ArrowRight, ChevronLeft } from "lucide-react";
import Link from "next/link";

import { AgentMark } from "@/components/v2/app/mark/AgentMark";
import { pageH1, pageSub, surface } from "@/components/v2/app/ui";
import type { AppKey, AppT } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

import { GUIDES, guideOf, nextGuide, type GuideId } from "./guides";

const key = (k: string) => k as AppKey;
const card = "flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] transition-colors duration-150 hover:bg-surface-2 sm:p-5";
const goLink = "inline-flex min-h-11 items-center gap-2 rounded-lg border border-brand-edge bg-brand px-4 text-base font-semibold text-on-brand";

/** Help: a calm list of short guides, each with Agent OWL in the mood that fits it (job BT). Every member may read it. */
export function HelpIndex({ t, base, lang }: { t: AppT; base: string; lang: Lang }) {
  return (
    <div data-screen="help" className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <AgentMark px={80} mood={"answering"} className="size-20 shrink-0 sm:size-24" />
        <div className="min-w-0">
          <h1 className={`${pageH1} mt-0`}>{t("help.title")}</h1>
          <p className={pageSub}>{t("help.sub")}</p>
        </div>
      </header>
      <ul aria-label={t("help.guides")} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GUIDES.map((g) => (
          <li key={g.id}>
            <Link href={`${base}/help/${g.id}`} className={card}>
              <AgentMark px={48} mood={g.mood} className="size-12" />
              <span className="font-display text-xl font-semibold leading-tight">{t(key(`help.guide.${g.id}.t`))}</span>
              <span className="text-base text-muted">{t(key(`help.guide.${g.id}.s`))}</span>
              {g.englishOnly && lang !== "en" ? <span lang="en" className="mt-auto text-sm text-muted">English</span> : null}
              <span className="mt-auto inline-flex items-center gap-1 text-base font-semibold text-brand-text">
                {t("help.read")}
                <ArrowRight className="size-4" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One guide: the owl with the one-line summary, numbered steps, the button to the screen it is about, and the next guide. */
export function HelpGuide({ id, t, base, lang, role }: { id: GuideId; t: AppT; base: string; lang: Lang; role: string }) {
  const g = guideOf(id);
  const next = nextGuide(id);
  return (
    <article data-screen="help-guide" data-guide={id} className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href={`${base}/help`} className="inline-flex min-h-11 items-center gap-1 text-base font-semibold text-brand-text">
        <ChevronLeft className="size-5" aria-hidden="true" />
        {t("help.back")}
      </Link>
      <header className="flex items-center gap-4">
        <AgentMark px={96} mood={g.mood} className="size-24 shrink-0 sm:size-28" />
        <div className="min-w-0">
          <h1 className={`${pageH1} mt-0`}>{t(key(`help.guide.${id}.t`))}</h1>
          <p className={pageSub}>{t(key(`help.guide.${id}.s`))}</p>
        </div>
      </header>
      {g.englishOnly && lang !== "en" ? (
        <p role="note" className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
          {t("help.english")}
        </p>
      ) : null}
      <section aria-labelledby="steps-h" className={surface}>
        <h2 id="steps-h" className="font-display text-xl font-semibold">
          {t("help.steps")}
        </h2>
        <ol className="mt-4 flex flex-col gap-4">
          {Array.from({ length: g.steps }, (_, i) => i + 1).map((n) => (
            <li key={n} className="flex gap-3">
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full border border-brand-edge bg-brand text-base font-semibold text-on-brand">
                {n}
              </span>
              <p className="min-w-0 pt-1 text-base">{t(key(`help.guide.${id}.${n}`))}</p>
            </li>
          ))}
        </ol>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        {g.roles.includes(role) ? (
          <Link href={`${base}${g.path}`} className={goLink}>
            {t(key(`help.guide.${id}.go`))}
            <ArrowRight className="size-5" aria-hidden="true" />
          </Link>
        ) : null}
        <Link href={`${base}/help/${next.id}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-base font-semibold text-brand-text hover:underline">
          {t("help.next")}: {t(key(`help.guide.${next.id}.t`))}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
