import type { ReactNode } from "react";

import { CardPlaceholder, Placeholder } from "../../ds/Placeholder";
import { NeedsBox, ResultsBox, VisitsBox, WorkingBox, YourDayBox } from "./V6Layout";

/**
 * What Today holds in the place of each part while that part is being read (design system v6; today-stream.tsx). Every box is the size of the real part, measured from the real rendering at a 390 px phone and a 1280 px desktop
 * (`audit/perf/`, 19 Nov 2026), so when the part arrives nothing moves. Where the real size depends on the data (how many things wait, how many visits) the placeholder is the size of the usual case: three rows. The classes are written HERE
 * (not in the page) because Tailwind only generates the classes it finds under components/v2.
 */

/** The dark band: a phone's is compact (the greeting, a two-line briefing, the status), a desktop's is the tall one with the orb and the composer. Shared with the band's own loading box so it never changes size between the two. */
export const BAND_BOX = "min-h-[124px] md:min-h-[315px]";
/** `tall`: the briefing is the long one on a phone (it names a quote: 4 lines, 43 px more than 2), so the band holds that room too and nothing under it moves when the band arrives (staging 19 Nov: the band grew 124 -> 167 px and "Needs you" moved down, CLS 0.048). */
export const BandPlaceholder = ({ tall = false }: { tall?: boolean }) => <div aria-hidden="true" data-placeholder="" className={`ds-hero ${tall ? "min-h-[167px] md:min-h-[315px]" : BAND_BOX}`} />;

/**
 * The briefing's lines in the band's own box (`.ds-brief` gives it the font, the line height and the margin of the real line): two lines on a phone, one on a desktop, as the usual briefing is. Nothing to read: no word the real line would not say.
 */
/** `lines`: the room the real line will take on a phone (2 lines; 4 when a quote is waiting, whose sentence names the customer and the amount): the line's own height is reserved, so nothing below it moves when it arrives. */
export const BriefingPlaceholder = ({ lines = 2 }: { lines?: 2 | 4 }) => (
  <p aria-hidden="true" data-placeholder="" data-part="briefing" className={`ds-brief motion-safe:animate-pulse ${lines === 4 ? "min-h-[4lh]" : "min-h-[2lh]"}`}>
    <span className="block w-[88%] max-w-[560px] rounded-md bg-white/10">{" "}</span>
    <span className="block w-[60%] max-w-[320px] rounded-md bg-white/10 md:hidden">{" "}</span>
  </p>
);

export const YourDayPlaceholder = () => (
  <YourDayBox>
    <CardPlaceholder className="min-h-[219px] lg:min-h-[175px]" />
  </YourDayBox>
);

/**
 * "Needs you": the heading and the rows the list is likely to have. A phone shows up to six rows. The small briefing read says how many things wait (`count`, `needs_you`), but the list that arrives is sometimes ONE LONGER (C2, 19 Nov 2026: it adds Lead Desk's and the Lead Finder's items, and
 * the plan's one upsell row, which is never counted as waiting; measured CLS 0.03 to 0.064 in 2 of 5 warm runs when exactly `count` rows were reserved), so the box reserves ONE MORE row than the count, at most six; a count of 0 reserves the empty state's own height
 * (the one line "nothing needs you"); a count that is not known reserves three rows. The desktop keeps its one height.
 * The heights are MEASURED, at 390 px, light, from the real rows (`NeedsYou` in the design system v6, a row of two title lines is 80 px, the most a row can be: its title is clamped to two lines), inside the list's own border and dividers (1 px each): n rows = 81 n + 1 px; the empty state is 44 px.
 * Above three rows the real heading row is 44 px, not 28, because the "See all" button (min-h-11) joins it.
 */
export const NEEDS_EMPTY = "min-h-[44px]";
const PHONE_ROWS: Record<number, string> = { 1: "min-h-[82px]", 2: "min-h-[163px]", 3: "min-h-[244px]", 4: "min-h-[325px]", 5: "min-h-[406px]", 6: "min-h-[487px]" };
/** How many rows to hold room for: null = not known (three); 0 = the empty state; else one more than the count, never more than six. */
export const needsRowsReserved = (count: number | null): number => (count === null ? 3 : count <= 0 ? 0 : Math.min(count + 1, 6));
export const NeedsPlaceholder = ({ rows = null }: { rows?: number | null }) => {
  const reserved = needsRowsReserved(rows);
  return (
    <NeedsBox>
      <div aria-hidden="true" data-placeholder="" data-reserved-rows={reserved} className="flex min-w-0 flex-col gap-3 p-4 md:p-5">
        {reserved > 3 ? (
          <div className="flex h-11 items-center">
            <Placeholder className="h-7 w-40" />
          </div>
        ) : (
          <Placeholder className="h-7 w-40" />
        )}
        <CardPlaceholder className={`${reserved === 0 ? NEEDS_EMPTY : PHONE_ROWS[reserved]} lg:min-h-[223px]`} />
      </div>
    </NeedsBox>
  );
};

export const WorkingPlaceholder = () => (
  <WorkingBox>
    <CardPlaceholder className="min-h-[109px]" />
  </WorkingBox>
);

export const VisitsPlaceholder = () => (
  <VisitsBox>
    <CardPlaceholder className="min-h-[206px] lg:min-h-[216px]" />
  </VisitsBox>
);

export const ResultsPlaceholder = () => (
  <ResultsBox>
    <CardPlaceholder className="min-h-[242px]" />
  </ResultsBox>
);

/** What a part says when its reads failed (one quiet sentence, with the page's own words). */
export const PartUnavailable = ({ children }: { children: ReactNode }) => (
  <p role="status" data-part="part-unavailable" className="rounded-xl border border-line bg-surface px-4 py-3 text-base text-muted">
    {children}
  </p>
);
