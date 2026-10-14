"use server";

import { revalidatePath } from "next/cache";

import { submitAccountSetup } from "@/lib/api/account";
import { getCurrentPolicies } from "@/lib/api/policy";
import { requireUser } from "@/lib/auth/session";

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
  if (result.ok) revalidatePath("/app");
  return result;
}
