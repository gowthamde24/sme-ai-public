import type { ReactNode } from "react";

import { container } from "@/components/v2/site/ui";

/** The page head of the launch public pages: the title (with the Draft tag where the wording waits for the owner), one grey sentence. Flat: no band, no tint. */
export function PubHead({ title, sub, draft }: { title: string; sub?: string; draft?: string }) {
  return (
    <section aria-labelledby="h1" className={`${container} pb-2 pt-8 sm:pt-12`}>
      <h1 id="h1" className="max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl">
        {title}
        {draft ? <DraftTag text={draft} /> : null}
      </h1>
      {sub ? <p className="mt-3 max-w-2xl text-lg text-muted">{sub}</p> : null}
    </section>
  );
}

/** A small outlined label, never a coloured pill: "Draft for approval". */
export function DraftTag({ text }: { text: string }) {
  return (
    <span data-part="draft-tag" className="ml-3 inline-block translate-y-[-0.15em] whitespace-nowrap rounded-full border border-edge px-2.5 py-0.5 align-middle text-sm font-semibold text-muted">
      {text}
    </span>
  );
}

/** The column the prose pages sit in (the approved mock's 760 px). */
export function PubBody({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={`${container} pb-16`}>{wide ? children : <div className="max-w-[760px]">{children}</div>}</div>;
}

export const subHead = "mb-1 mt-9 font-display text-2xl font-bold text-ink";

/** A numbered list of plain steps or rules on hairlines: open rows, no card per row. */
export function Steps({ items }: { items: readonly { head?: string; text: string }[] }) {
  return (
    <ol className="mt-4 border-t border-ink" data-part="steps">
      {items.map((it, i) => (
        <li key={i} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-line py-4">
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-full border border-line text-sm font-bold text-muted">{i + 1}</span>
          <p className="text-base leading-relaxed text-muted">
            {it.head ? <b className="font-semibold text-ink">{it.head} </b> : null}
            {it.text}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** One status: a dot and one honest sentence. */
export function Dot({ tone, children }: { tone: "ok" | "bad" | "idle"; children: ReactNode }) {
  const color = tone === "ok" ? "bg-green-text" : tone === "bad" ? "bg-[#c2410c]" : "bg-edge";
  return (
    <span className="inline-flex items-center gap-3">
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${color}`} />
      {children}
    </span>
  );
}
