import Link from "next/link";
import type { ReactNode } from "react";

import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BASE_URL, LABEL, LANGS, SAMPLE, STEPS, type Lang } from "@/lib/developer/overview";

export const TABS = ["overview", "keys", "hooks", "activity", "docs"] as const;
export type Tab = (typeof TABS)[number];

/**
 * The Developers page (mock "Developers"): Overview (three steps, the base address, a first request in cURL, Node or Python), the tabs, and plain "not open yet" notices for what C1's developer API has not opened. Developer-facing text is English (`lang="en"`); the page's own words arrive as props.
 */
export function DevelopersView({ words, ui, base, tab, lang, keys }: { words: Readonly<Record<string, string>>; ui: string; base: string; tab: Tab; lang: Lang; keys: ReactNode }) {
  return (
    <main className={pageMain} lang={ui}>
      <PageTop title={words["dvp.title"] ?? "Developers"} sub={words["dvp.sub"]} />
      <nav aria-label={words["dvp.title"]} className="mt-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((k) => (
          <Link key={k} href={`${base}?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`inline-flex min-h-11 items-center border-b-2 px-3.5 text-[15px] font-semibold ${tab === k ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {words[`dvp.tab.${k}`]}
          </Link>
        ))}
      </nav>
      <div className="mt-4 flex max-w-3xl flex-col gap-4">
        {tab === "overview" ? (
          <>
            <ol className="m-0 flex list-none flex-col border-t border-ink p-0" lang="en" data-part="dev-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 border-b border-line py-4">
                  <span aria-hidden="true" className={`grid size-[30px] place-items-center rounded-full border text-[15px] font-bold ${i === 0 ? "border-ink bg-ink text-surface" : "border-line text-muted"}`}>
                    {i + 1}
                  </span>
                  <div>
                    <h2 className="m-0 text-[17px] font-semibold text-ink">{s.title}</h2>
                    <p className="m-0 mt-1 text-[15px] text-muted">{s.text}</p>
                    {s.tab ? (
                      <Link href={`${base}?tab=${s.tab}`} className="mt-2 inline-flex min-h-11 items-center text-[15px] font-semibold text-ink underline underline-offset-4">
                        {words[`dvp.tab.${s.tab}`]}
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            <dl lang="en" className="m-0 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-bold text-ink">Base address</dt>
                <dd className="m-0 break-all font-mono text-[15px] text-ink">{BASE_URL}</dd>
              </div>
              <div>
                <dt className="text-sm font-bold text-ink">Sign in with</dt>
                <dd className="m-0 font-mono text-[15px] text-ink">Authorization: Bearer YOUR_KEY</dd>
              </div>
            </dl>
            <p lang="en" className="m-0 text-[14px] text-muted">
              Add an Idempotency-Key header to every request that writes: sending it twice never makes two calls.
            </p>
            <div role="group" aria-label="Language" className="inline-flex self-start rounded-full border border-line p-[3px]">
              {LANGS.map((l) => (
                <Link key={l} href={`${base}?tab=overview&lang=${l}`} aria-current={lang === l ? "true" : undefined} className={`inline-flex min-h-10 items-center rounded-full px-4 text-[15px] font-semibold ${lang === l ? "bg-ink text-surface" : "text-body"}`}>
                  {LABEL[l]}
                </Link>
              ))}
            </div>
            <pre data-part="dev-sample" lang="en" className="m-0 max-w-full overflow-x-auto rounded-[10px] border border-line px-3.5 py-3 font-mono text-[14px] leading-[1.55] text-ink">
              <code>{SAMPLE[lang]}</code>
            </pre>
            <p role="note" className="m-0 border-y border-line py-3 text-[15px] text-muted">
              {words["dvp.soon"]}
            </p>
          </>
        ) : null}
        {tab === "keys" ? keys : null}
        {tab === "hooks" || tab === "activity" || tab === "docs" ? (
          <p role="note" className="m-0 border-y border-line py-3 text-[15px] text-muted">
            {words["dvp.soon"]}
          </p>
        ) : null}
      </div>
    </main>
 
  );
}
