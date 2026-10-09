/**
 * The shapes of what the frame reads from the data layer (Job AC contract, from Claude 1). They mirror lib/api: `getPlan()`, `getAiUsageToday()` and the
 * `cards.waiting` of `getToday()`. Until those exist the frame is given null and draws "Not available yet" (never a made-up value). Money is in paise.
 */
export type Plan = { plan: string; workspace_limit: number; trial_started_at: string | null };
export type AiUsage = { spent_paise: number; cap_paise: number; left_paise: number };
/** What the frame shows beyond the menu: the plan under the business name, the AI usage card, the count on "Today". Each is null while it cannot be read. */
export type FrameData = { plan: Plan | null; usage: AiUsage | null; waiting: number | null };
export const NO_FRAME_DATA: FrameData = { plan: null, usage: null, waiting: null };
