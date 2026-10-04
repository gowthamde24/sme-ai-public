/**
 * Post-login redirect targets come from the URL (`?next=`) and the form, i.e. from an attacker.
 * Accept only same-site relative paths; anything else becomes the default. This blocks open
 * redirects such as `//evil.example`, `/\evil.example`, `https://evil.example`,
 * `javascript:...`, and encoded or whitespace-obfuscated variants.
 */
export const DEFAULT_REDIRECT = "/app";

const MAX_LENGTH = 2048;
const PLACEHOLDER_ORIGIN = "http://redirect-check.invalid";

// Raw input: refuse control characters (tab/newline are stripped by browsers, turning "/<TAB>/x"
// into "//x"), spaces, DEL/C1 controls and backslashes (browsers treat "\" like "/").
const FORBIDDEN_RAW = /[\x00-\x20\x7f-\x9f\\]/;
// Decoded input: the same, except that an encoded space (%20) is legitimate.
const FORBIDDEN_DECODED = /[\x00-\x1f\x7f-\x9f\\]/;

export function safeRedirectPath(
  input: unknown,
  fallback: string = DEFAULT_REDIRECT,
): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > MAX_LENGTH
  )
    return fallback;
  if (
    !input.startsWith("/") ||
    input.startsWith("//") ||
    FORBIDDEN_RAW.test(input)
  ) {
    return fallback;
  }

  // Also judge the decoded form: "/%2f%2fevil.example" and "/%5Cevil.example" must not pass.
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return fallback;
  }
  if (decoded.startsWith("//") || FORBIDDEN_DECODED.test(decoded))
    return fallback;

  // Final authority: it must still resolve to our own origin.
  let url: URL;
  try {
    url = new URL(input, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;

  // Never bounce back into the login page (redirect loops).
  if (url.pathname === "/login" || url.pathname.startsWith("/login/"))
    return fallback;

  return url.pathname + url.search;
}
