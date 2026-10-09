"use server";

import { revalidatePath } from "next/cache";

import { submitAccountSetup } from "@/lib/api/account";
import { requireUser } from "@/lib/auth/session";

import { runCompleteSetup, type CompleteSetupResult } from "./setup-logic";

/**
 * First-login setup (job AD / D2): `completeSetup({ businessType, language })` -> `{ ok: true }` or `{ ok: false, error }`.
 * Makes the account's one business (name from sign-up) with the person as Owner. The logic is in setup-logic.ts.
 */
export async function completeSetup(input: {
  businessType: "textiles" | "construction" | "other";
  language: "en" | "te" | "hi" | "kn";
}): Promise<CompleteSetupResult> {
  const user = await requireUser();
  const result = await runCompleteSetup(input, { token: user.accessToken, submit: submitAccountSetup });
  if (result.ok) revalidatePath("/app");
  return result;
}
