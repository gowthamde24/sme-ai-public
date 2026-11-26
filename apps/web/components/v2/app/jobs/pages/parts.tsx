import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The small parts the plain-sentence pages share under JOBS (Catalogue, Reports, Phone number, Leads, Calls; the simplicity pass). Plain markup, no state and no "use client": a server page draws them, and a client form can too.
 * The choices that change (a pill inside a sentence) are `LinkSentence` (a lazy chunk); the parts here only hold them.
 */
export const pgCard = "rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5";

/** "What it will do:" / "Showing ..." with one live line (the same grey box as the job page and the rules). */
export function EffectLine({ label, text, part = "effect" }: { label?: string; text: string; part?: string }) {
  return (
    <p data-part={part} role="status" className="m-0 rounded-xl bg-[var(--jb-info-soft)] px-3.5 py-3 text-[14px] leading-snug text-ink">
      {label ? <b>{label} </b> : null}
      {text}
    </p>
  );
}

/** "More choices" on the same page: closed unless `open` (a choice inside is already on); the rare things live inside. */
export function MoreBox({ title, sub, open = false, children }: { title: string; sub: string; open?: boolean; children: ReactNode }) {
  return (
    <details data-part="more-choices" open={open} className="group rounded-xl border border-line px-3.5 py-1">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-display text-[16px] font-bold leading-tight text-ink">{title}</span>
          <span className="block text-sm text-muted">{sub}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 pb-3 pt-1">{children}</div>
    </details>
  );
}
