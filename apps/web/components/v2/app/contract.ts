import type { Plan } from "@/lib/api/plan";
import type { AiUsage } from "@/lib/api/ai-usage";

import type { PackFrame } from "./nav";

/**
 * What the frame reads from the data layer. The types ARE lib/api's (`getPlan()`, `getAiUsage()` and the `cards.waiting` of `getToday()`, Job AD): this file only
 * says what the frame does with them. A part that cannot be read is null and the frame says "Not available yet" (never a made-up value). Money is in paise.
 */
export type { AiUsage, PackFrame, Plan };
export type FrameData = {
  plan: Plan | null;
  usage: AiUsage | null;
  /** how many things wait for the person (the count on "Today") */
  waiting: number | null;
  /** false = the numbers are still being brought in (the first paint): the frame draws the places empty instead of saying "Not available yet" */
  ready: boolean;
  /** false for a role the AI usage is not shown to (the API gives it to Owner and Admin only): the card is not drawn */
  showUsage: boolean;
  /** "Live now" is switched on for this workspace (ACTIVITY_SCREENS): the menu and the phone's line ask what the assistant is doing. */
  live: boolean;
  /** The business's uploaded logo (a signed address that expires in ten minutes; the next page load brings a fresh one), or null: the menu then shows a letter avatar of the business name. */
  logoUrl: string | null;
  /** The business type of the workspace as the menu needs it (job CL): modules, phone tabs and changed words. null = not known (the menu is the one the product always had). */
  pack: PackFrame | null;
  /** App v4 is on (APP_V4): the five-group menu (components/v2/app/nav.ts, MENU_V4) and the parts that follow. Absent = off. */
  v4?: boolean;
  /** Design system v6 is on (DESIGN_V6): the new side menu and the new pages. Absent = off. */
  ds?: boolean;
  /** The rupee balance for the menu's business card ("₹1,550"), or null when it is not known. Only with `ds`. Never "credits". */
  balance?: { text: string; low: boolean; minutes: number | null } | null;
  /** The assistant's state for the menu's "My assistant" badge (Not live / In training / Live), or null when it is not known. Only with `ds`. */
  assistant?: "not_live" | "in_training" | "live" | null;
};
/** Every part unreadable: the frame says "Not available yet" in each place. */
export const NO_FRAME_DATA: FrameData = { plan: null, usage: null, waiting: null, ready: true, showUsage: true, live: false, logoUrl: null, pack: null };
/** Not read yet (the layout above the workspace cannot know which workspace it is; the workspace's own layout brings the numbers in). */
export const FRAME_LOADING: FrameData = { plan: null, usage: null, waiting: null, ready: false, showUsage: true, live: false, logoUrl: null, pack: null };
