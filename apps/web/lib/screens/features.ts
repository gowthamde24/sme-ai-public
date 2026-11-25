import { appV4, crmPushScreens, earlyAccess, jobsScreens, leadsScreens, offerScreens, outreachScreens, taskScreens, topupScreens } from "./flag";

/**
 * The names of the parts of the workspace that are switched ON by a feature flag (night 4): what the menu may offer. A NavItem names its `feature`; the page behind it answers 404 on its own when its flag is off, so the menu is
 * only a convenience. Read by the SERVER at request time (the flags are environment variables, not baked into the bundle).
 */
/** `app_v4`: the pages that exist only in app v4 (APP_V4), e.g. the Phone calls list. */
export type Feature = "leads" | "outreach" | "tasks" | "topups" | "app_v4" | "offers" | "early_access" | "jobs" | "connectors";

export function enabledFeatures(): Feature[] {
  const on: Feature[] = [];
  if (leadsScreens() !== "off") on.push("leads");
  if (outreachScreens() !== "off") on.push("outreach");
  if (taskScreens() !== "off") on.push("tasks");
  if (topupScreens() !== "off") on.push("topups");
  if (offerScreens() !== "off") on.push("offers"); // campaigns S4: Who wants offers, the offer form
  if (jobsScreens() !== "off") on.push("jobs"); // JOBS: the Jobs row and page
  if (crmPushScreens() !== "off") on.push("connectors"); // results into the business's own CRM or sheet
  if (appV4()) on.push("app_v4");
  if (earlyAccess()) on.push("early_access"); // free early access: no Billing row, no money screens
  return on;
}
