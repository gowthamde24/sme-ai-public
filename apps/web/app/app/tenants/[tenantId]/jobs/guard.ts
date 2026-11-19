import { appT, type AppT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { jobsScreens } from "@/lib/screens/flag";

import { DECIDERS, invalid, who, type Refused, type Role } from "../retailers/finder-guard";

/**
 * The check every JOBS server action starts with (not a "use server" file: this is not an action). With JOBS off the screens answer 404, so the actions behind them must not run either: the same "invalid" answer the first
 * JOBS actions gave, before anything is read, verified or sent (the person is not even asked who they are). Otherwise it is `who`: the person's role must be one of `allowed` (Owner and Admin by default).
 */
export async function jobsWho(tenantId: string, allowed: readonly Role[] = DECIDERS): Promise<{ token: string; t: AppT } | Refused> {
  if (jobsScreens() === "off") return invalid(appT(await getLang()));
  return who(tenantId, allowed);
}
