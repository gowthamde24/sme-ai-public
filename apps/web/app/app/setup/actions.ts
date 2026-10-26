"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { submitAccountSetup } from "@/lib/api/account";
import { getCurrentPolicies } from "@/lib/api/policy";
import { requireUser } from "@/lib/auth/session";
import { SIGNUP_MARKETING_COOKIE } from "@/lib/dpdp/cookie";
import { changeMarketing } from "@/lib/dpdp/source";
import { dpdpScreens } from "@/lib/screens/flag";

import type { CompleteSetupInput, CompleteSetupResult } from "@/lib/api/signup";

import { runCompleteSetup } from "./setup-logic";

/**
 * First-login setup (job AD / D2): `completeSetup({ businessType, language })` -> `{ ok: true }` or `{ ok: false, error }`.
 * Makes the account's one business (name from sign-up) with the person as Owner. The logic is in setup-logic.ts.
 */
export async function completeSetup(input: CompleteSetupInput): Promise<CompleteSetupResult> {
  const user = await requireUser();
  // an account made by e-mail carries the versions it accepted on the sign-up page; one made through Google or Facebook has no form, and the person was shown "By continuing you agree to the Terms and the Privacy Policy" on the sign-up
  // page, so the setup records the versions in force (the database writes the acceptance before it makes the business, job CK). If they cannot be read the business is still made and the accept page asks.
  const policies = user.signupPolicies ?? (await getCurrentPolicies().catch(() => undefined));
  const result = await runCompleteSetup(input, { token: user.accessToken, submit: submitAccountSetup, policies });
  if (result.ok) {
    await recordSignupMarketing(user.accessToken, user.signupMarketing === true);
    revalidatePath("/app");
  }
  return result;
}

/**
 * The person ticked the separate, unticked box for news and offers on the sign-up page (job DQ part 2): by e-mail it is in the account's metadata, through Google or Facebook it is in a cookie of the browser that went there. The first
 * sign-in records it with the API once (the same one call that gives and withdraws consent; "signup", or "google" for Google). A failure changes nothing: the box simply counts as not ticked, which is the safe side. Only while the consent API is on.
 */
async function recordSignupMarketing(token: string, byEmail: boolean): Promise<void> {
  if (dpdpScreens() === "off") return;
  let provider: string | undefined;
  try {
    const jar = await cookies();
    provider = jar.get(SIGNUP_MARKETING_COOKIE)?.value;
    if (provider !== undefined) jar.delete(SIGNUP_MARKETING_COOKIE);
  } catch {
    provider = undefined;
  }
  if (!byEmail && provider !== "google" && provider !== "facebook") return;
  await changeMarketing(token, true, provider === "google" ? "google" : "signup");
}
