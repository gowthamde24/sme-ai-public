import type { ReactNode } from "react";

import type { Words } from "../../words";
import type { DayOneActions } from "./day-one/DayOne";
import type { StepView } from "./day-one/steps";
import type { SourceRow } from "./Lower";
import type { Working } from "./lower-data";
import type { StatusData } from "./StatusCard";

/** What the day-one checklist is given (the page decides everything; the checklist only draws). */
export type DayOneIn = { name: string; steps: StepView[]; canGoLive: boolean; missing: ("business_name" | "phone_number")[]; actions: DayOneActions; helpHref: string; testCallHref: string };

/**
 * What the page gives Today for the design system v6 (DESIGN_V6): the words, the language's name, the parts of the status card that are not computed from Today's own data, the day-one checklist (or null) and the "Finish setup" chip (or null).
 * Today's own data (the cards, the visits, the new leads) is read inside TodayView, where it already is.
 */
export type V6In = {
  words: Words;
  language: string;
  /** The business's own language code (its profile's first language), or null. */
  businessLang: string | null;
  number: string | null;
  last: StatusData["last"];
  mock: StatusData["mock"];
  mockMore: number;
  /** "Your assistant is working on": the approved job (null = none; the card says so), and when it was approved ("9:05" in India). */
  working: Working | null;
  workingTime: string | null;
  /** "Where enquiries came from" (this week); empty = not drawn. */
  sources: SourceRow[];
  dayOne: DayOneIn | null;
  chip: ReactNode;
};
