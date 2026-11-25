import { ApiAuthError } from "@/lib/api/client";
import { readLines as apiLines } from "@/lib/api/phone-lines";
import { callsPanel, phoneLinesScreens } from "@/lib/screens/flag";

import { MOCK_LINES, type Lines } from "./types";

/**
 * Where the "Calls at once" card gets its lines. `off` (the flag is unset, or CALLS_PANEL is) = the card is not there; `mock` = a made-up two-line answer, nothing is read; `ok` = C1's route, shown as it is; `unread` = the route could not be read (an older server answers 404, a
 * failure answers 5xx): the card says so, it never guesses a number. A sign-in problem is the caller's (it redirects to the login page).
 */
export type Read = { mode: "off" } | { mode: "unread" } | { mode: "ok"; lines: Lines; mock: boolean };

export async function readPhoneLines(token: string, tenantId: string): Promise<Read> {
  const mode = phoneLinesScreens();
  if (!callsPanel() || mode === "off") return { mode: "off" };
  if (mode === "mock") return { mode: "ok", lines: MOCK_LINES, mock: true };
  try {
    const lines = await apiLines(token, tenantId);
    return lines ? { mode: "ok", lines, mock: false } : { mode: "unread" };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { mode: "unread" };
  }
}
