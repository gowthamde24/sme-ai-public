import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * "More choices" on the same page for the parts of Settings that are drawn on the SERVER (the quote versions, the privacy page): the same look and markup as `MoreChoices` of jobs/rules/parts.tsx, but a plain details with no script,
 * so the Settings route does not take that client file (and what it pulls in) into its first load (route-JS ceiling). Client parts keep using `MoreChoices`.
 */
export function MoreDetails({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <details data-part="more-choices" className="group rounded-xl border border-line px-3.5 py-1">
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
