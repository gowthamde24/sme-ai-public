import { CANONICAL_ORIGIN, SECURITY_ADDRESS } from "@/lib/site/business";

/** How long a security.txt is valid: a year from the moment it is asked for (RFC 9116 wants an Expires line; it rolls forward as long as the site is up). */
const VALID_MS = 365 * 24 * 3600 * 1000;

/**
 * /.well-known/security.txt (RFC 9116): where to report a vulnerability and what to expect. Plain text, the same on every host, never cached for long. The policy it points to is the Security page, which says only what is true.
 */
export function GET(): Response {
  const body = [
    `Contact: mailto:${SECURITY_ADDRESS}`,
    `Expires: ${new Date(Date.now() + VALID_MS).toISOString()}`,
    "Preferred-Languages: en, te, hi, kn",
    `Canonical: ${CANONICAL_ORIGIN}/.well-known/security.txt`,
    `Policy: ${CANONICAL_ORIGIN}/security`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
