import type { SitePage, SiteTarget } from "./paths";

/**
 * Website-only mode (job DQ): the public website can be live on stack19.com while the app stays closed. `SITE_MODE=website` is read by the SERVER when it handles a request (a Cloud Run environment variable, not baked into
 * the bundle); anything else, or nothing, is the usual behaviour ("app"): every page, sign-in and sign-up as before.
 *
 * In website mode only these pages are served: the home page, the business types' pages, plans (the pricing page), contact, and the legal texts (privacy, terms, data deletion). /app, sign-in, sign-up and the other
 * sign-in pages show "Opening soon — book a demo" (proxy.ts), and the pages that explain the product to people who already use it (how it works, security, help) are not served. Pure: no request API.
 */
export type SiteMode = "app" | "website";

export const siteMode = (value: string | undefined = process.env.SITE_MODE): SiteMode => (value === "website" ? "website" : "app");
export const websiteOnly = (): boolean => siteMode() === "website";

/** The fixed pages of the site that website mode serves (the business types' pages and the home page always are). */
export const WEBSITE_PAGES: readonly SitePage[] = ["pricing", "contact"];

export const isServed = (target: SiteTarget, mode: SiteMode = siteMode()): boolean => mode === "app" || target.kind !== "page" || WEBSITE_PAGES.includes(target.page);

/** The addresses website mode answers with "Opening soon" (the app and everything that signs a person in). */
const CLOSED = ["/app", "/login", "/signup", "/setup", "/auth"] as const;
// "/app" is matched like proxy.ts matches it (every address that starts with it), so no address of the app is left open by a spelling
export const isClosedPath = (pathname: string): boolean => pathname.startsWith("/app") || CLOSED.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** The two hosts the public website is known by: only a response served from them may be indexed (a copy on another address, such as staging, never is). */
export const PUBLIC_HOSTS: readonly string[] = ["stack19.com", "www.stack19.com"];
export const isPublicHost = (host: string | null | undefined): boolean => host != null && PUBLIC_HOSTS.includes(host.toLowerCase().replace(/:\d+$/, ""));
