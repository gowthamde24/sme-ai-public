import Link from "next/link";

/**
 * "1 offer is waiting for your approval" (owner, 18 Nov; campaigns S4): a quiet line above "Needs you", for the Owner only. It is not a card in "Needs you": that heading and the menu's number stay C1's one count.
 * `line` and `open` are already in the person's language; `href` opens the one offer, or the Campaigns page when several wait.
 */
export function OffersLine({ line, open, href }: { line: string; open: string; href: string }) {
  return (
    <p data-part="offers-waiting" className="m-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-4 py-2 text-base text-ink">
      <span>{line}</span>
      <Link href={href} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">
        {open}
      </Link>
    </p>
  );
}
