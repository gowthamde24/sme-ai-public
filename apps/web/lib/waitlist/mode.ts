import { screenMode, type ScreenMode } from "@/lib/screens/flag";
import { siteMode } from "@/lib/site/mode";
import { waitlistApiBase } from "./api-base";

/**
 * Is the waitlist form on the public pages, and where does it send? `WAITLIST` is read by the SERVER at each request: off (the form is not there), `mock` (it takes the details and keeps nothing: for review and the pictures) or `1`
 * (C1's POST /public/waitlist). Unset: ON in website mode (the form is the way in while the app is closed) and off otherwise; in website mode `on` also needs `WAITLIST_API_BASE` (the production API; without it: off), so a deployment without SITE_MODE=website looks exactly as before.
 */
export function waitlistMode(value: string | undefined = process.env.WAITLIST, mode = siteMode(), base: string | null = waitlistApiBase()): ScreenMode {
  const wanted = value === undefined || value === "" ? (mode === "website" ? "on" : "off") : screenMode(value);
  // the live website: the form posts to a real API only when `WAITLIST_API_BASE` names one (api-base.ts); the address baked into the image is staging's. `mock` keeps nothing, so it needs no address.
  return wanted === "on" && mode === "website" && base === null ? "off" : wanted;
}
