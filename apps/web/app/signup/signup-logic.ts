import type { SignUpResult } from "@/lib/api/signup";
import { padTo } from "@/lib/auth/otp";
import { validateNewPassword } from "@/lib/auth/password-policy";
import type { SignupLimiter } from "@/lib/auth/signup-limit";
import { TERMS_VERSION } from "@/lib/auth/terms";

// The input, error and result types live in lib/api/signup.ts so the screens import them from there.
export type { SignUpError, SignUpInput, SignUpResult } from "@/lib/api/signup";

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

/** Every well-formed request that reaches the Auth server takes at least this long to answer (the same value the password-reset request uses). */
const MIN_MILLISECONDS = 800;
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
 * NO ACCOUNT ENUMERATION (ADR 0003): a sign-up with an address that already has an account answers exactly like a new one,
 * `{ ok: true, next: "check-email" }`, and sends no second account into being. Whether the Auth server says "already registered" (this local
 * stack), or hides it with a user that has no identities (a hosted project), the answer is the same, and both outcomes are held to the same
 * minimum duration so the speed of the answer does not tell the two apart either. The person who owns the address simply gets no new mail.
 */
export async function runSignUp(
  input: unknown,
  deps: { auth: SignUpAuth; limiter: SignupLimiter; ip: string; minMilliseconds?: number },
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

  const started = Date.now();
  const sameAnswer = async (): Promise<SignUpResult> => {
    await padTo(started, deps.minMilliseconds ?? MIN_MILLISECONDS);
    return { ok: true, next: "check-email" };
  };

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
        return sameAnswer(); // an address that already has an account is not revealed
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
  // A project that hides existing accounts answers a repeat sign-up with a user that has no identities (and sends no mail): the same answer.
  return sameAnswer();
}
