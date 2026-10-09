import { NO_FRAME_DATA, type FrameData } from "@/components/v2/app/contract";

/**
 * What the frame shows besides the menu: the plan under the business name, the AI usage card and the count on Today. They come from `getPlan()`,
 * `getAiUsageToday()` and `getToday().cards.waiting` of lib/api (Job AD, Claude 1). Those do not exist yet, so each is null and the frame says
 * "Not available yet". When they land, call them HERE (one place), each in its own try/catch so one failure shows only its own "Not available yet".
 */
export async function readFrameData(): Promise<FrameData> {
  return NO_FRAME_DATA;
}
