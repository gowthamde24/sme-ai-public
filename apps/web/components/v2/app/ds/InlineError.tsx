"use client";

/**
 * A page that could not read its data says so in ONE row with the way out (product audit: an error was printed as a paragraph of the page body with nothing to press). The sentence is the page's own; "Try again" loads the page again from the server. The same row everywhere.
 */
export function InlineError({ text, retry }: { text: string; retry: string }) {
  return (
    <div role="alert" data-part="inline-error" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-text bg-amber-bg px-4 py-3 text-base text-amber-text">
      <span className="min-w-0">{text}</span>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-amber-text px-4 text-sm font-semibold hover:bg-surface">
        {retry}
      </button>
    </div>
  );
}
