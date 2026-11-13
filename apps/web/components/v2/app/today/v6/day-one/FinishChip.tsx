import Link from "next/link";

import { makeT, type Words } from "../../../words";
import { STEP_IDS } from "./steps";

/**
 * The small "Finish setup · N/7" chip at the top of the normal Today (design system v6): tapping it reopens the checklist, the cross puts it away for good. A server component: the dismiss is a server action, so no script is needed for it.
 */
export function FinishChip({ done, base, words, dismiss }: { done: number; base: string; words: Words; dismiss: () => Promise<void> }) {
  const t = makeT(words);
  return (
    <div data-part="finish-chip" className="inline-flex max-w-full items-center self-start overflow-hidden rounded-full border border-brand-edge bg-brand-bg text-sm font-semibold text-brand-text">
      <Link href={`${base}?setup=1`} className="inline-flex min-h-11 items-center px-4 hover:underline">
        {t("tv6.chip.finish", { done, total: STEP_IDS.length })}
      </Link>
      <form action={dismiss}>
        <button type="submit" aria-label={t("tv6.chip.hide")} title={t("tv6.chip.hide")} className="inline-flex min-h-11 min-w-11 items-center justify-center hover:bg-surface-2">
          <span aria-hidden="true">×</span>
        </button>
      </form>
    </div>
  );
}
