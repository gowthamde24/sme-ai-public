import type { NextRequest } from "next/server";
import { notFound } from "next/navigation";

import { BRAND_NAME } from "@/design/brand";
import { siteT } from "@/i18n/site";
import { PUBLIC_URL } from "@/lib/seo/site";
import { landingDraft } from "@/lib/screens/flag";
import { LANDING_DRAFT_HTML } from "@/lib/site/landing-draft-html";

import { homeEarly } from "@/components/v2/site/home2/early";

// the page is built per request: the nonce of the response's Content-Security-Policy (set by proxy.ts) goes on its two inline scripts and its style element
export const dynamic = "force-dynamic";

/** Where "Join early access" leads: exactly where the live home page's early-access button leads (the form of the home page, or sign-up, or in website mode the contact page's form). */
function joinHref(): string {
  const href = homeEarly(siteT("en"), "en").href;
  const full = href.startsWith("#") ? `/${href}` : href;
  return /^\/[A-Za-z0-9/_#-]*$/.test(full) ? full : "/signup";
}

/**
 * /landing-draft: the animated landing page (hero, 13 business types, "Try it", plans, questions), a DRAFT for the owner's review. It exists only where LANDING_DRAFT is on (staging); everywhere else it is a plain 404.
 * One self-contained HTML document made from the prototype (lib/site/landing-draft-html.ts, generated): server-made, no client component, so it adds nothing to the route-JS budget; its only scripts are two small inline ones
 * that carry the request's nonce. Never indexed (noindex in the page and X-Robots-Tag). `?lang=te` makes the Telugu page the first view and its share picture the Telugu one.
 */
export async function GET(request: NextRequest): Promise<Response> {
  if (!landingDraft()) notFound();
  const lang = request.nextUrl.searchParams.get("lang") === "te" ? "te" : "en";
  const nonce = (request.headers.get("x-nonce") ?? "").replace(/[^A-Za-z0-9+/=]/g, "");
  const html = LANDING_DRAFT_HTML.replaceAll("__NONCE__", nonce)
    .replaceAll("__BRAND__", BRAND_NAME)
    .replaceAll("__JOIN__", joinHref())
    .replaceAll("__OG_IMAGE__", `${PUBLIC_URL}/og/landing-${lang}.png`);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
