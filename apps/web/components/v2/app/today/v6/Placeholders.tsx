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
export const BandPlaceholder = () => <div aria-hidden="true" data-placeholder="" className={`ds-hero ${BAND_BOX}`} />;

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

/** "Needs you": the heading and the first three rows (a phone shows up to six, a desktop three; the usual number waiting). */
/** The phone shows up to six rows of "Needs you" (about 80 px each): the box reserves the rows the small briefing read says there are (`needsYou`), so "Your day" and the cards below do not move when the list arrives (null = not known: three rows). The desktop keeps its one height. */
const PHONE_ROWS: Record<number, string> = { 0: "min-h-[110px]", 1: "min-h-[85px]", 2: "min-h-[165px]", 3: "min-h-[245px]", 4: "min-h-[325px]", 5: "min-h-[405px]", 6: "min-h-[480px]" };
export const NeedsPlaceholder = ({ rows = null }: { rows?: number | null }) => (
  <NeedsBox>
    <div aria-hidden="true" data-placeholder="" className="flex min-w-0 flex-col gap-3">
      <Placeholder className="h-7 w-40" />
      <CardPlaceholder className={`${PHONE_ROWS[rows === null ? 3 : Math.min(Math.max(rows, 0), 6)]} lg:min-h-[223px]`} />
    </div>
  </NeedsBox>
);

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
  <p role="status" data-part="part-unavailable" className="rounded-2xl border border-line bg-surface px-4 py-3 text-base text-muted">
    {children}
  </p>
);
