import type { ReactNode } from "react";

/**
 * Where the parts of Today sit in the design system v6 (the final design): the dark band (or the day-one checklist), the full-width "Your day", then two columns: Needs you and "Your assistant is working on" | Today's visits and "This week's results".
 * On a phone the sections follow each other (the order classes on each part) and "Your day" scrolls sideways. ONE place for the boxes, so the page that has everything at once (`TodayView`) and the page that draws in parts as they are read
 * (`TodayStreamed`) put every part in the same place with the same classes: a part that arrives later takes the room its placeholder held.
 * Each slot is the part WITH its own box (the `order-N` div), or null where the part is not drawn.
 */
export function V6Layout({ band, yourDay, needs, working, visits, results }: { band: ReactNode; yourDay: ReactNode; needs: ReactNode; working: ReactNode; visits: ReactNode; results: ReactNode }) {
  return (
    <>
      <div className="order-1 min-w-0">{band}</div>
      {yourDay}
      <div data-part="v6-lower" className="contents lg:order-3 lg:grid lg:min-w-0 lg:grid-cols-[1.25fr_1fr] lg:items-start lg:gap-[18px]">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-[18px]">
          {needs}
          {working}
        </div>
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-[18px]">
          {visits}
          {results}
        </div>
      </div>
    </>
  );
}

/** The boxes of the parts, so a placeholder and the part it stands for have the same one. */
export const YourDayBox = ({ children }: { children: ReactNode }) => <div className="order-3 min-w-0 lg:order-2">{children}</div>;
export const NeedsBox = ({ children }: { children: ReactNode }) => <div className="order-2 min-w-0 lg:order-none">{children}</div>;
export const WorkingBox = ({ children }: { children: ReactNode }) => <div className="order-4 min-w-0 lg:order-none">{children}</div>;
export const VisitsBox = ({ children }: { children: ReactNode }) => <div className="order-5 min-w-0 lg:order-none">{children}</div>;
export const ResultsBox = ({ children }: { children: ReactNode }) => <div className="order-6 min-w-0 lg:order-none">{children}</div>;
