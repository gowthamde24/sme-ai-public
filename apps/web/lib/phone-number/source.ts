import { readJar } from "@/lib/mock/jar";
import { phoneNumberScreens } from "@/lib/screens/flag";

import { NOTHING, parsePhone, type PhoneNumber } from "./types";

/**
 * Where Settings > Phone number gets its state (job B6). `mock` = ONE small cookie of the browser (the test screen: nothing is bought, rented or rung); `on` = C1's API, which does not exist yet (ADR 0120 step 2), so the part says it is not available; `off` = the part is not there.
 * Every move checks its input again here (the browser is not trusted). Only the Owner changes anything (the action checks the role).
 */
export const COOKIE = "sme_phone_number_mock";
export type Read = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; data: PhoneNumber; mock: boolean };

export async function readPhone(): Promise<Read> {
  const mode = phoneNumberScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "on") return { mode: "unavailable" };
  return { mode: "ok", data: await readJar(COOKIE, parsePhone, NOTHING), mock: true };
}
