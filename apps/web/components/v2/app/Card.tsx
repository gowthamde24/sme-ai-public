import type { ReactNode } from "react";

/**
 * THE one box for a section of a page (owner-approved boxy mock, 26 Nov 2026, mocks/app-v2-boxy): white, a 4 px radius (the shared token --v2-r-card), a thin border, one soft shadow, the heading INSIDE at the top. The page behind it is the soft tint (`--v2-bg`).
 * RULE (one rule so every page stays consistent): a section that is loose on the page, with a heading above its content, becomes a Card with a SectionHeading inside; a row list, a form or a table of that section goes in the Card's body. A Card never holds another Card: parts inside it are rows divided by hairlines.
 */
export const cardBox = "min-w-0 rounded-[var(--v2-r-card)] border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5";

/** The heading of a Card: 17 px, bold, with an optional count and one action on the right. */
export function SectionHeading({ id, children, count, action, as: Tag = "h2" }: { id?: string; children: ReactNode; count?: ReactNode; action?: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div data-part="section-heading" className="mb-3 flex min-h-7 items-center gap-2.5">
      <Tag id={id} className="m-0 font-display text-[17px] font-extrabold leading-snug text-ink">
        {children}
      </Tag>
      {count !== undefined && count !== null ? <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-surface-2 px-2 text-sm font-bold text-muted">{count}</span> : null}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

/** A section as a box with its heading inside. `as` is the element (a `section` by default); the rest goes to it as attributes (data-part, aria-labelledby...). */
export function Card({ title, headingId, count, action, children, as: Tag = "section", className = "", ...rest }: { title?: ReactNode; headingId?: string; count?: ReactNode; action?: ReactNode; children: ReactNode; as?: "section" | "div" | "article"; className?: string } & Record<`data-${string}` | `aria-${string}`, string | undefined>) {
  return (
    <Tag {...rest} className={`${cardBox} ${className}`.trim()}>
      {title ? (
        <SectionHeading id={headingId} count={count} action={action}>
          {title}
        </SectionHeading>
      ) : null}
      {children}
    </Tag>
  );
}
