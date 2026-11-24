import Link from "next/link";

import { btnMainLink, btnQuiet } from "../ui";

/**
 * One lead source guide (mock "Lead sources" guide): the steps, the lines to copy, the "works with" chips, the note about the lead address and the two buttons "Email this to my developer" and "Have us set it up" (prepared mails). Developer-facing text is English (`lang="en"`); the page's
 * own words arrive as props. No backend: everything here is data.
 */
export function GuideView({ back, backWord, steps, code, works, workWith, note, mailHref, mailWord, setupHref, setupWord, setupNote, lang }: { back: string; backWord: string; steps: readonly string[]; code?: string; works: boolean; workWith: readonly string[]; note: string; mailHref: string; mailWord: string; setupHref: string; setupWord: string; setupNote: string; lang: string }) {
  return (
    <>
      <Link href={back} className="mb-1 inline-block py-1.5 text-[15px] font-semibold text-muted hover:text-ink">
        {backWord}
      </Link>
      <div className="mt-4 flex max-w-3xl flex-col gap-4" lang="en">
        <ol className="m-0 flex list-none flex-col border-t border-ink p-0" data-part="guide-steps">
          {steps.map((s, i) => (
            <li key={s} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 border-b border-line py-4">
              <span aria-hidden="true" className={`grid size-[30px] place-items-center rounded-full border text-[15px] font-bold ${i === 0 ? "border-ink bg-ink text-surface" : "border-line text-muted"}`}>
                {i + 1}
              </span>
              <p className="m-0 text-[16px] text-ink">{s}</p>
            </li>
          ))}
        </ol>
        {code ? (
          <pre data-part="guide-code" className="m-0 max-w-full overflow-x-auto rounded-[10px] border border-line px-3.5 py-3 font-mono text-[14px] leading-[1.55] text-ink">
            <code>{code}</code>
          </pre>
        ) : null}
        {works ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-part="works-with">
            {workWith.map((w) => (
              <li key={w} className="rounded-full border border-line px-3 py-1 text-[14px] text-body">
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="m-0 mt-4 border-y border-line py-3 text-[15px] text-muted" lang={lang}>
        {note}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3" lang={lang}>
        <a href={mailHref} className={btnMainLink} data-part="mail-developer">
          {mailWord}
        </a>
        <a href={setupHref} className={btnQuiet} data-part="set-up-for-me">
          {setupWord}
        </a>
      </div>
      <p className="m-0 mt-2 text-[14px] text-muted" lang={lang}>
        {setupNote}
      </p>
    </>
  );
}
