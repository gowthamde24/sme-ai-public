"use client";

import { Suspense, lazy, type ComponentType, type ReactNode } from "react";

import type { FaqCard as FaqCardType, FindsOutCard as FindsOutCardType } from "./JobLists";
import type { WhoTalks as WhoTalksType } from "./WhoTalks";

/**
 * The parts of the job page that sit below the first screen, or that most jobs never show, as their own lazy chunks: the page must stay under its route-JS ceiling.
 * One small helper builds the three wrappers (a quiet fallback while a chunk loads; the Who talks card draws a block of about its height so the page does not jump). Same props as the real components.
 */
function card<P extends object>(Lazy: ComponentType<P>, fallback: ReactNode = null) {
  return function Card(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

export const FaqCard = card(lazy(() => import("./JobLists").then((m) => ({ default: m.FaqCard as typeof FaqCardType }))));
export const FindsOutCard = card(lazy(() => import("./JobLists").then((m) => ({ default: m.FindsOutCard as typeof FindsOutCardType }))));
export const WhoTalks = card(
  lazy(() => import("./WhoTalks").then((m) => ({ default: m.WhoTalks as typeof WhoTalksType }))),
  <span data-skeleton="" className="jb-skeleton block h-72 rounded-2xl" />,
);
