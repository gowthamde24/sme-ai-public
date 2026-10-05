/**
 * Content-Security-Policy for every page (ADR 0016 / T006b M3a). A fresh nonce per request: Next.js reads it from the
 * header and puts it on its own inline scripts and styles, so there is no 'unsafe-inline' for scripts and 'strict-dynamic'
 * lets those scripts load their chunks. Pages that use a nonce must render dynamically (the root layout opts in).
 *
 * Decisions, each with its reason:
 *  - connect-src 'self': the browser talks only to this app. The API and Supabase are called from the server.
 *  - style-src: nonce only in production; development adds 'unsafe-inline' (hot-reload injects un-nonced <style>).
 *  - style-src-attr 'unsafe-inline': React renders `style="..."` attributes; an attribute cannot run code. Style ELEMENTS still need the nonce.
 *  - img-src data: blob: for the authenticator QR code (an SVG data URI) and Next's image placeholders.
 *  - 'unsafe-eval' only in development (React's debugging needs it), never in production.
 *  - upgrade-insecure-requests only in production, so plain-http local development keeps working.
 */
export function buildCsp(nonce: string, dev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // development only: Next's hot-reload injects <style> elements without a nonce ('unsafe-inline' is ignored when a nonce is present)
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

/** 128 bits from the platform's CSPRNG, base64 (the shape the Next.js guide uses). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
