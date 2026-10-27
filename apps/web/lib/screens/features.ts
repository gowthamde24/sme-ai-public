import { leadsScreens, outreachScreens, taskScreens, topupScreens } from "./flag";

/**
 * The names of the parts of the workspace that are switched ON by a feature flag (night 4): what the menu may offer. A NavItem names its `feature`; the page behind it answers 404 on its own when its flag is off, so the menu is
 * only a convenience. Read by the SERVER at request time (the flags are environment variables, not baked into the bundle).
 */
export type Feature = "leads" | "outreach" | "tasks" | "topups";

export function enabledFeatures(): Feature[] {
  const on: Feature[] = [];
  if (leadsScreens() !== "off") on.push("leads");
  if (outreachScreens() !== "off") on.push("outreach");
  if (taskScreens() !== "off") on.push("tasks");
  if (topupScreens() !== "off") on.push("topups");
  return on;
}
