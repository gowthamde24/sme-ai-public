import type { ReactNode } from "react";

/**
 * The head of a design-system-v6 page: the page's title as its H1 (the menu's word), one plain line under it, and the page's main action on the right (the "?" help is in the top bar). A phone stacks them. Every v6 page starts with this, so they look like one product.
 */
export function PageHeader({ title, sub, right = null, badge = null }: { title: string; sub?: string; right?: ReactNode; badge?: ReactNode }) {
  return (
    <header data-part="page-header" className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[28px] font-semibold leading-[1.1] md:text-4xl">{title}</h1>
          {badge}
        </div>
        {sub ? <p className="mt-1.5 max-w-2xl text-base text-muted">{sub}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div> : null}
    </header>
  );
}
