import { headers } from "next/headers";

import { isPublicHost, siteMode, type SiteMode } from "@/lib/site/mode";

import { SITE_LIVE } from "./site";

/**
 * May search engines index this response (job DQ)? Yes when the launch switch is on (NEXT_PUBLIC_SITE_LIVE=1: the old rule, whatever the address), or when the deployment is in website mode (SITE_MODE=website) AND the response is served
 * from stack19.com or www.stack19.com. A copy on any other address (staging, a preview) is never indexable, however it is configured, so staging stays noindex without a setting of its own.
 */
export function indexableFor(host: string | null | undefined, mode: SiteMode = siteMode(), live: boolean = SITE_LIVE): boolean {
  return live || (mode === "website" && isPublicHost(host));
}

/** The host the visitor used (Cloud Run and the proxy in front of it may rename the Host header; the forwarded one is the visitor's). */
export function requestHost(h: { get(name: string): string | null }): string | null {
  return (h.get("x-forwarded-host") ?? h.get("host"))?.split(",")[0]?.trim() ?? null;
}

export async function requestIndexable(): Promise<boolean> {
  if (SITE_LIVE) return true;
  if (siteMode() !== "website") return false;
  return indexableFor(requestHost(await headers()));
}
