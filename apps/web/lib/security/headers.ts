/**
 * The static security headers for every response (next.config.ts). The Content-Security-Policy is NOT here: it carries a
 * per-request nonce, so proxy.ts sets it. HSTS is sent only in production (over https; sending it from http://localhost
 * would be ignored by browsers and wrong for a local build).
 */
export type Header = { key: string; value: string };

export function securityHeaders(production: boolean): Header[] {
  const headers: Header[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    // legacy twin of frame-ancestors 'none' for old browsers
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (production)
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  return headers;
}
