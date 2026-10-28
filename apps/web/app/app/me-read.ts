import { cache } from "react";

import { fetchMe } from "@/lib/api/client";
import { getMyProfile } from "@/lib/api/me";

/**
 * `GET /v1/me` once per request (job CH): the frame of /app (the menu's workspaces) and the /app page itself both read it, and one page load should ask the API once. Outside a request (tests, client code) `cache`
 * does not remember, so every call asks, as before.
 */
export const readMeCached = cache((accessToken: string) => fetchMe(accessToken));

/** The person's own name and picture (`GET .../me/profile`) once per request: the menu footer draws them. */
export const readMyProfileCached = cache((accessToken: string, tenantId: string) => getMyProfile(accessToken, tenantId));
