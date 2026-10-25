/**
 * The feature flag of the plan screens (job DK). Off by default, until billing is real: unset, "0" or anything else = off (Settings has no Plan part and /plans is a 404); "1" = on, reading C1's plans API (which is not
 * there yet: the screens say "Not available yet"); "mock" = on with an in-memory FAKE provider whose state lives in a cookie (for review and screenshots; no network, no money, nothing stored on a server).
 * Read when the server handles a request (not baked into the bundle), like lib/auth/signup-open.ts.
 */
export type PlanScreens = "off" | "on" | "mock";
export function planScreens(value: string | undefined = process.env.NEXT_PUBLIC_PLAN_SCREENS): PlanScreens {
  return value === "mock" ? "mock" : value === "1" ? "on" : "off";
}
