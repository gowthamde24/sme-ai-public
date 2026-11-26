"use client";

import * as React from "react";

import { btnQuiet } from "../../ui";

/**
 * Wraps the Calls table so long pages (e.g. 50 rows) show the first batch (20 rows) initially
 * and reveal the next pre-rendered batches in-place on "Show more", keeping timestamps and formatting on the server.
 */
export function CallsTablePager({
  caption,
  head,
  first,
  batches,
  counts,
  moreLabel,
}: {
  caption: string;
  head: React.ReactNode;
  first: React.ReactNode;
  batches: readonly React.ReactNode[];
  counts: readonly number[];
  moreLabel: string;
}) {
  const [open, setOpen] = React.useState(0);
  const remaining = counts.slice(open).reduce((sum, n) => sum + n, 0);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--v2-shadow)]" data-part="calls-table">
      <table className="block w-full border-collapse text-[13.5px] md:table">
        <caption className="sr-only">{caption}</caption>
        {head}
        {first}
        {batches.slice(0, open)}
      </table>
      {remaining > 0 ? (
        <div className="flex justify-center border-t border-line p-3">
          <button type="button" onClick={() => setOpen((n) => n + 1)} className={btnQuiet} data-part="calls-show-more">
            {moreLabel} ({remaining})
          </button>
        </div>
      ) : null}
    </div>
  );
}
