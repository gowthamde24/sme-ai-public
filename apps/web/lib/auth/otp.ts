/** The only link types /auth/confirm accepts, and what happens next for each. */
export const CONFIRM_TYPES = ["invite", "recovery", "email"] as const;
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

export function parseConfirmType(value: unknown): ConfirmType | null {
  return typeof value === "string" &&
    (CONFIRM_TYPES as readonly string[]).includes(value)
    ? (value as ConfirmType)
    : null;
}

/** A token hash from an e-mail link: URL-safe characters only, bounded. Anything else is not even sent to the Auth server. */
export function parseTokenHash(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,256}$/.test(value)
    ? value
    : null;
}

/** An authenticator code is exactly six digits. */
export function parseTotpCode(value: unknown): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, "") : "";
  return /^\d{6}$/.test(text) ? text : null;
}

/** Hold a response until at least `ms` after `startedAt`, so a fast path cannot be told from a slow one (no account enumeration). */
export async function padTo(startedAt: number, ms: number): Promise<void> {
  const wait = ms - (Date.now() - startedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
