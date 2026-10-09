import { validateNewPassword } from "@/lib/auth/password-policy";
import type { SignupLimiter } from "@/lib/auth/signup-limit";
import { TERMS_VERSION } from "@/lib/auth/terms";

/** What the sign-up form sends. Everything is checked again here, on the server. */
export type SignUpInput = {
  name: string;
  email: string;
  password: string;
  businessName: string;
  acceptTerms: boolean;
};

export type SignUpError =
  | "email_taken"
  | "weak_password"
  | "terms_required"
  | "too_many_signups"
  | "invalid";

export type SignUpResult =
  | { ok: true; next: "check-email" }
  | { ok: false; error: SignUpError };

/** The slice of the Supabase Auth client the sign-up uses (so a test can stand in for it). */
export interface SignUpAuth {
  signUp(args: {
    email: string;
    password: string;
    options: { data: Record<string, string> };
  }): Promise<{
    data: { user?: { identities?: unknown[] | null } | null } | null;
    error: { code?: string; status?: number } | null;
  }>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MAX_NAME = 100;
const MAX_BUSINESS = 120;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Open sign-up. Order of checks: the fields; the terms; the password; the per-address brake; then the Auth server. The Auth server sends the
 * confirmation link (to the local mail catcher on a developer machine) and the database records the terms, with its own clock, when the account
 * is made. No account exists as a business until the person has confirmed the address and done the first-login setup.
 *
 * Telling a person "email_taken" is what the owner's contract asks for; it does tell a stranger that an address has an account. The brake
 * below and the Auth server's rate limits are what hold that down (docs/adr/0061-open-sign-up.md).
 */
export async function runSignUp(
  input: unknown,
  deps: { auth: SignUpAuth; limiter: SignupLimiter; ip: string },
): Promise<SignUpResult> {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const name = text(raw.name);
  const email = text(raw.email).toLowerCase();
  const businessName = text(raw.businessName);
  const password = typeof raw.password === "string" ? raw.password : "";

  if (
    name.length < 1 || name.length > MAX_NAME ||
    !EMAIL.test(email) || email.length > MAX_EMAIL ||
    businessName.length < 1 || businessName.length > MAX_BUSINESS
  ) {
    return { ok: false, error: "invalid" };
  }
  if (raw.acceptTerms !== true) return { ok: false, error: "terms_required" };
  if (validateNewPassword(password, password, email) !== null) return { ok: false, error: "weak_password" };
  if (!deps.limiter.allow(deps.ip)) return { ok: false, error: "too_many_signups" };

  let result: Awaited<ReturnType<SignUpAuth["signUp"]>>;
  try {
    result = await deps.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name, business_name: businessName, terms_version: TERMS_VERSION },
      },
    });
  } catch {
    return { ok: false, error: "invalid" };
  }

  const { data, error } = result;
  if (error) {
    switch (error.code) {
      case "user_already_exists":
      case "email_exists":
        return { ok: false, error: "email_taken" };
      case "weak_password":
        return { ok: false, error: "weak_password" };
      case "over_email_send_rate_limit":
      case "over_request_rate_limit":
        return { ok: false, error: "too_many_signups" };
      default:
        return error.status === 429
          ? { ok: false, error: "too_many_signups" }
          : { ok: false, error: "invalid" };
    }
  }
  // A project that hides existing accounts answers a repeat sign-up with a user that has no identities (and sends no mail).
  if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
    return { ok: false, error: "email_taken" };
  }
  return { ok: true, next: "check-email" };
}
