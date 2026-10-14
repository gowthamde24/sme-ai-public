import { cache } from "react";

import { ApiAuthError } from "@/lib/api/client";
import { fixtureWorkspacePack, getWorkspacePack, type WorkspacePack } from "@/lib/api/pack";

/**
 * The workspace's pack once per request (the frame, the template and the page all ask). A rejected session is passed on; any other failure of the read gives the default pack's file (the same stand-in the adapter uses
 * when the route does not exist), so a hiccup of one read never takes a whole page down. Outside a request (tests) `cache` does not remember, so every call asks.
 */
export const readPackCached = cache(async (accessToken: string, tenantId: string): Promise<WorkspacePack> => {
  try {
    return await getWorkspacePack(accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return fixtureWorkspacePack();
  }
});
