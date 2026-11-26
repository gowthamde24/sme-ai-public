import type { Users } from "lucide-react";
import type { ReactNode } from "react";

/** The small parts every plan card is made of (a titled row with an icon) and its two buttons' looks: shared by the plan card and its lazy research-plan part. */
export const primary = "jb-press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-brand-edge bg-brand px-5 text-[15px] font-bold text-on-brand disabled:opacity-60";
export const secondary = "jb-press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-edge bg-surface px-4 text-[15px] font-semibold text-ink disabled:opacity-60";

export function Part({ icon: Icon, label, children, part }: { icon: typeof Users; label: string; children: ReactNode; part: string }) {
  return (
    <section data-part={part} className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 border-t border-line py-3">
      <Icon aria-hidden="true" className="mt-0.5 size-5 text-muted" />
      <div className="min-w-0">
        <h3 className="m-0 text-[12px] font-bold uppercase tracking-wider text-muted">{label}</h3>
        <div className="mt-1 text-[15px] leading-snug text-ink">{children}</div>
      </div>
    </section>
  );
}
