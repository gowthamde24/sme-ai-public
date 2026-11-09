import { appV4, leadsScreens, outreachScreens, taskScreens, topupScreens } from "./flag";

/**
 * The names of the parts of the workspace that are switched ON by a feature flag (night 4): what the menu may offer. A NavItem names its `feature`; the page behind it answers 404 on its own when its flag is off, so the menu is
 * only a convenience. Read by the SERVER at request time (the flags are environment variables, not baked into the bundle).
 */
/** `app_v4`: the pages that exist only in app v4 (APP_V4), e.g. the Phone calls list. */
export type Feature = "leads" | "outreach" | "tasks" | "topups" | "app_v4";

export function enabledFeatures(): Feature[] {
  const on: Feature[] = [];
  if (leadsScreens() !== "off") on.push("leads");
  if (outreachScreens() !== "off") on.push("outreach");
  if (taskScreens() !== "off") on.push("tasks");
  if (topupScreens() !== "off") on.push("topups");
  if (appV4()) on.push("app_v4");
  return on;
}
