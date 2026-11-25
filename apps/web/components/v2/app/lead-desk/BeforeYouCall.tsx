import { makeT, type Words } from "../words";

const RULES = ["1", "2", "3", "4", "5"] as const;

/**
 * "Before you start calling" (mock "Before you start calling"): the five plain rules of calling, one panel on Calls (open) and on Lead sources (closed behind "Read the five rules"). Open rows between hairlines, nothing boxed. The hours say what the call gate does.
 */
export function BeforeYouCall({ words, open = true }: { words: Words; open?: boolean }) {
  const t = makeT(words);
  return (
    <details open={open} data-part="before-you-call" className="group border-y border-line">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 text-[17px] font-bold text-ink [&::-webkit-details-marker]:hidden">
        {t("bsc.title")}
        <span className="ml-auto text-sm font-semibold text-muted group-open:hidden">{t("bsc.read")}</span>
      </summary>
      <ol className="m-0 flex list-none flex-col p-0">
        {RULES.map((n) => (
          <li key={n} className="grid grid-cols-[26px_minmax(0,1fr)] gap-3 border-t border-line py-3 text-[15px] text-body">
            <span aria-hidden="true" className="grid size-[22px] place-items-center rounded-full border border-line text-[13px] font-bold text-muted">
              {n}
            </span>
            <span>
              <b className="font-semibold text-ink">{t(`bsc.r${n}.t` as "bsc.r1.t")}</b> {t(`bsc.r${n}.x` as "bsc.r1.x")}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
