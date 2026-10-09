import type { Plan } from "@/lib/api/plan";
import type { AiUsage } from "@/lib/api/today";

/**
 * What the frame reads from the data layer. The types ARE lib/api's (`getPlan()`, `getAiUsageToday()` and the `cards.waiting` of `getToday()`, Job AD): this file only
 * says what the frame does with them. A part that cannot be read is null and the frame says "Not available yet" (never a made-up value). Money is in paise.
 */
export type { AiUsage, Plan };
export type FrameData = {
  plan: Plan | null;
  usage: AiUsage | null;
  /** how many things wait for the person (the count on "Today") */
  waiting: number | null;
  /** false = the numbers are still being brought in (the first paint): the frame draws the places empty instead of saying "Not available yet" */
  ready: boolean;
  /** false for a role the AI usage is not shown to (the API gives it to Owner and Admin only): the card is not drawn */
  showUsage: boolean;
};
/** Every part unreadable: the frame says "Not available yet" in each place. */
export const NO_FRAME_DATA: FrameData = { plan: null, usage: null, waiting: null, ready: true, showUsage: true };
/** Not read yet (the layout above the workspace cannot know which workspace it is; the workspace's own layout brings the numbers in). */
export const FRAME_LOADING: FrameData = { plan: null, usage: null, waiting: null, ready: false, showUsage: true };
