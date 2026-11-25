import { SITE_URL } from "@/lib/seo/site";

import { isPublicHost, websiteOnly } from "./mode";

/** The app's address when the public website (stack19.com) is served by itself: the sign-in is on the app's own host. (Owner, 26 Nov 2026.) */
export const PUBLIC_APP_ORIGIN = "https://app.stack19.com";

/**
 * Where "Log in" leads. In the usual mode the app is on the same address as the pages, so it is `/login`. In website mode (the public site, where `/login` only says "Opening soon") the link goes to the app: the address this deployment is served from
 * (NEXT_PUBLIC_SITE_URL, so staging and previews lead to their own app), or the app's address when that address is the public site's own (stack19.com, www).
 */
export function loginHref(mode: boolean = websiteOnly(), siteUrl: string = SITE_URL): string {
  if (!mode) return "/login";
  let host = "";
  try {
    host = new URL(siteUrl).host;
  } catch {
    return `${PUBLIC_APP_ORIGIN}/login`;
  }
  return `${isPublicHost(host) ? PUBLIC_APP_ORIGIN : siteUrl.replace(/\/+$/, "")}/login`;
}
