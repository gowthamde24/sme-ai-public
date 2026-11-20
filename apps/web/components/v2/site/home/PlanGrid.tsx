"use client";

import type { ReactNode } from "react";

import { useOnViewOnce } from "./use-on-view-once";

/**
 * The three plan cards of the home page: stacked on a phone so all three can be compared, side by side from 768 px (design/home4.css). The only thing a client does here is the one calm moment: the Pro card's minutes bar fills ONCE when the cards scroll into
 * view (`data-phase`, use-on-view-once.ts; the server draws it full, so no JavaScript or "reduce motion" shows it finished).
 */
export function PlanGrid({ children }: { children: ReactNode }) {
  const [ref, phase] = useOnViewOnce<HTMLUListElement>(0.2);
  return (
    <ul className="h4-plans" ref={ref} data-phase={phase} data-part="plans">
      {children}
    </ul>
  );
}
