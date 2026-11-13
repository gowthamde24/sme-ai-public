import type { ReactNode } from "react";

import type { Words } from "../../words";
import type { DayOneActions } from "./day-one/DayOne";
import type { StepView } from "./day-one/steps";
import type { Working } from "./lower-data";
import type { ResultsView } from "./results-data";

/** What the day-one checklist is given (the page decides everything; the checklist only draws). */
export type DayOneIn = { name: string; steps: StepView[]; canGoLive: boolean; missing: ("business_name" | "phone_number")[]; actions: DayOneActions; helpHref: string; testCallHref: string };

/**
 * What the page gives Today for the design system v6 (DESIGN_V6): the words, the language's name, the business name and language, today's calls (the start times, for "Your day"; null = not known), the approved job, this week's results, a made-up live call (staging only), the day-one checklist
 * (or null) and the "Finish setup" chip (or null). Today's own data (the cards, the visits, the new leads) is read inside TodayView, where it already is.
 */
export type V6In = {
  words: Words;
  language: string;
  /** The business's own language code (its profile's first language), or null. */
  businessLang: string | null;
  shop: string;
  working: Working | null;
  results: ResultsView;
  dayCalls: string[] | null;
  mockLive: { caller: string } | null;
  dayOne: DayOneIn | null;
  chip: ReactNode;
};
