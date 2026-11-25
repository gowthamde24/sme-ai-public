import { makeT, type Words } from "../words";

/** The low-balance line (the neutral notice: a dot and a sentence between hairlines): "Your balance is low: about 4 minutes of calls left." with the Add credits button beside it when the person may add. */
export function LowBalance({ minutes, words, add }: { minutes: number; words: Words; add: React.ReactNode }) {
  const t = makeT(words);
  return (
    <div role="status" data-part="low-balance" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-line py-3 text-[15px] font-semibold text-ink">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-brand" />
      <span className="min-w-0 flex-1">{t("cr.low", { n: minutes })}</span>
      {add}
    </div>
  );
}
