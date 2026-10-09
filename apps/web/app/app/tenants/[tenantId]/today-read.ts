import { cache } from "react";

import { getToday } from "@/lib/api/today";

/**
 * `getToday` once per request: the workspace's layout (the count on "Today" in the menu) and the Today page both need it, and one page load should ask the API once.
 * Outside a request (tests, client code) `cache` does not remember, so every call asks.
 */
export const readTodayCached = cache((accessToken: string, tenantId: string) => getToday(accessToken, tenantId));
