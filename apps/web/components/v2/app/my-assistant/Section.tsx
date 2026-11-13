import Link from "next/link";
import type { ReactNode } from "react";

import { btnQuiet, fieldHelp, surface } from "../ui";

/** A titled card of My assistant with an anchor (`id`), one plain line, and optionally one link; the Knowledge tab's cards for the parts that live on their own pages (business details, catalogue, price list, website). */
export function Section({ id, title, text, link = null, children = null }: { id: string; title: string; text: string; link?: { href: string; label: string } | null; children?: ReactNode }) {
  return (
    <section id={id} data-part={`mya-${id}`} aria-labelledby={`${id}-h`} className={`${surface} flex flex-col gap-2`}>
      <h2 id={`${id}-h`} className="font-display text-xl font-semibold">
        {title}
      </h2>
      <p className={`${fieldHelp} mt-0`}>{text}</p>
      {children}
      {link ? (
        <div>
          <Link href={link.href} className={btnQuiet}>
            {link.label}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
