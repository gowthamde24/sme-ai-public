import { Placeholder } from "../ds/Placeholder";
import { card, withPanel } from "../v6/ui";

/**
 * What the Leads page holds in the place of the search, the chips, the table and the customer's panel while the leads are read: the same boxes in the same places, so the leads take their room without anything moving. The heading above is already the real one.
 * The sizes are the real ones, measured from the real rendering at a 390 px phone and a 1280 px desktop (`audit/perf/`, 19 Nov 2026): the search row 48 px, the chips 49 px, then the rows (a phone's card 94 px; a desktop's row with the table's own heading 52 px
 * above them) and, on a wide screen, the panel (254 px). Five rows is the usual first look; the real page has as many as it has leads.
 */
export function LeadsPlaceholder() {
  return (
    <div aria-hidden="true" data-placeholder="">
      <div className="mt-5 flex items-center gap-2">
        <Placeholder className="h-12 min-w-0 flex-1 rounded-lg md:max-w-md" />
        <Placeholder className="h-12 w-[82px]" />
      </div>
      <div className="mt-4">
        <Placeholder className="h-[48.8px] w-full max-w-xl rounded-full md:h-12" />
      </div>
      <div className={withPanel}>
        <div className="flex min-w-0 flex-col pt-2 md:gap-2">
          <Placeholder className="hidden h-[52px] md:block" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Placeholder key={i} className="h-[94px] rounded-xl md:h-[120px]" />
          ))}
        </div>
        <div className={`${card} hidden h-[254px] lg:block`} />
      </div>
    </div>
  );
}
