import Link from "next/link";
import type { ReactNode } from "react";

import { Orb } from "@/components/v2/Orb";

import { btnMain } from "../ui";

/**
 * An empty page shows its NEXT STEP (design system v6, owner 13 Nov 2026): the assistant's circle, one plain sentence about what will be here, and ONE button that does the next thing. `help` is optional small text under the button. Never a bare "Nothing here".
 */
export function EmptyNext({ title, text, action, help = null }: { title: string; text: string; action: { href: string; label: string }; help?: ReactNode }) {
  return (
    <section data-part="empty-next" className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-10 text-center shadow-[var(--v2-shadow)]">
      <Orb px={72} state="ambient" />
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <p className="text-base text-muted">{text}</p>
      <Link href={action.href} className={`${btnMain} mt-1`}>
        {action.label}
      </Link>
      {help ? <p className="text-sm text-muted">{help}</p> : null}
    </section>
  );
}
