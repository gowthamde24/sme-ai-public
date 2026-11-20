import { JobChip } from "../ds/JobChip";
import { makeT, type Words } from "../words";

/**
 * "Sample": the small chip on a part of a screen that the staging preview ("my business", lib/screens/preview.ts) drew from the sample data because the API route for it is not there yet. With `note` the plain sentence follows it. Pure: no script of its own.
 */
export function SampleChip({ words, note = false, className = "" }: { words: Words; note?: boolean; className?: string }) {
  const t = makeT(words);
  return (
    <span data-part="sample" className={`inline-flex flex-wrap items-center gap-2 ${className}`.trim()}>
      <JobChip tone="wait">{t("jobs.sample")}</JobChip>
      {note ? <span className="text-[14px] leading-snug text-muted">{t("jobs.sample.note")}</span> : null}
    </span>
  );
}
