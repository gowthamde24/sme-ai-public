import { screenMode, type ScreenMode } from "@/lib/screens/flag";
import { siteMode } from "@/lib/site/mode";

/**
 * Is the waitlist form on the public pages, and where does it send? `WAITLIST` is read by the SERVER at each request: off (the form is not there), `mock` (it takes the details and keeps nothing: for review and the pictures) or `1`
 * (C1's POST /public/waitlist). Unset: ON in website mode (the form is the way in while the app is closed) and off otherwise, so a deployment without SITE_MODE=website looks exactly as before.
 */
export function waitlistMode(value: string | undefined = process.env.WAITLIST, mode = siteMode()): ScreenMode {
  if (value === undefined || value === "") return mode === "website" ? "on" : "off";
  return screenMode(value);
}
