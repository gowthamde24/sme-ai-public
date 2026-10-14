import { cache } from "react";

import { ApiAuthError } from "@/lib/api/client";
import { getWorkspacePack } from "@/lib/api/pack";
import type { WorkspacePack } from "@/lib/packs/types";

/**
 * The workspace's pack once per request (the frame, the template and the page all ask). A rejected session is passed on; a server with no pack routes, or any failure of the read, gives null (the product as it always
 * was), so a hiccup of one read never takes a whole page down; the API and the database refuse a part the business type does not have regardless. Outside a request (tests) `cache` does not remember, so every call asks.
 */
export const readPackCached = cache(async (accessToken: string, tenantId: string): Promise<WorkspacePack | null> => {
  try {
    return await getWorkspacePack(accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
});
