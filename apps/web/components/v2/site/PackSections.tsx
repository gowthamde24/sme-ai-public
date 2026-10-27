import type { ReactNode } from "react";

import { h2Home, wrapHome } from "@/components/v2/site/ui";

const section = "scroll-mt-20 py-[84px] sm:py-[120px]";
export const slate = "text-muted";

/**
 * A section of a business type's page in the home page's design (night 5, v3): the wide column, the heading at the home page's size, the sentence under it at 19 px, alternate white and mist backgrounds. With `split` the heading stays at
 * the left (sticky on a laptop) and the content takes the right, the way "A day with ..." is drawn on the home page. No small capital labels, no card for what is not a screen object.
 */
export function V3Section({ id, title, sub, tone, split = false, children }: { id: string; title: string; sub?: string; tone?: "mist"; split?: boolean; children: ReactNode }) {
  const head = (
    <>
      <h2 id={`${id}-h`} className={h2Home}>
        {title}
      </h2>
      {sub ? <p className={`mt-5 max-w-[36em] text-[19px] ${slate}`}>{sub}</p> : null}
    </>
  );
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={`${section} ${tone === "mist" ? "bg-surface-2" : "bg-surface"}`}>
      <div className={wrapHome}>
        {split ? (
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:self-start">{head}</div>
            <div>{children}</div>
          </div>
        ) : (
          <>
            {head}
            <div className="mt-16">{children}</div>
          </>
        )}
      </div>
    </section>
  );
}

/** Plain sentences as rows with a short dash in front and a line between them (the home page's way of listing). */
export function DashRows({ items, part }: { items: readonly ReactNode[]; part?: string }) {
  return (
    <ul className="m-0 list-none border-t border-line p-0" data-part={part}>
      {items.map((it, i) => (
        <li key={i} className="relative border-b border-line py-5 pl-[26px] text-[19px] before:absolute before:left-0 before:top-[2.1rem] before:h-0.5 before:w-3 before:bg-brand-text">
          {it}
        </li>
      ))}
    </ul>
  );
}

/** Questions as native disclosures, as on the home page (no script). */
export function V3Faq({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <div className="max-w-[860px] border-t border-line">
      {items.map((it, i) => (
        <details key={i} className="group border-b border-line">
          <summary className="flex min-h-14 cursor-pointer list-none justify-between gap-5 py-6 text-[19px] font-semibold [&::-webkit-details-marker]:hidden">
            {it.q}
            <span aria-hidden="true" className="mt-1.5 size-3.5 shrink-0 rotate-45 border-b-2 border-r-2 border-brand-text transition-transform duration-200 group-open:-rotate-[135deg]" />
          </summary>
          <p className={`max-w-[44em] pb-6 ${slate}`}>{it.a}</p>
        </details>
      ))}
    </div>
  );
}
