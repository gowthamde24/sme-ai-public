import { websiteOnly } from "./mode";

/** The app's address when the public website (stack19.com) is served by itself: the sign-in is on the app's own host. (Owner, 26 Nov 2026.) */
export const PUBLIC_APP_ORIGIN = "https://app.stack19.com";

/**
 * Where "Log in" leads. In the usual mode the app is on the same address as the pages, so it is `/login`. In website mode (the public site, where `/login` only says "Opening soon") the link goes to the app: `SITE_APP_ORIGIN`, read by the SERVER
 * when it handles a request (a Cloud Run variable, like `SITE_MODE`; never the build-time NEXT_PUBLIC_SITE_URL, because the public site runs an image built for another address), or the app's address when it is not set or is not a web address.
 */
export function loginHref(mode: boolean = websiteOnly(), appOrigin: string | undefined = process.env.SITE_APP_ORIGIN): string {
  if (!mode) return "/login";
  let origin = PUBLIC_APP_ORIGIN;
  try {
    const u = new URL((appOrigin ?? "").trim());
    if (u.protocol === "https:" || u.protocol === "http:") origin = u.origin;
  } catch {
    // not set, or not an address: the app's own address
  }
  return `${origin}/login`;
}
