import type { ReactNode } from "react";

/** The older, longer list of sources (Google Sheets link, Zapier and webhooks, per-source pause and new address) under the simple cards: folded away, so the page opens on the cards alone (open when a mail could not be read: never silent). */
export function MoreWays({ title, open = false, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="mt-8" data-part="more-ways" open={open}>
      <summary className="min-h-11 cursor-pointer text-base font-semibold text-ink">{title}</summary>
      {children}
    </details>
  );
}
