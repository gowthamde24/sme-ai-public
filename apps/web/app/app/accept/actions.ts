"use server";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { failureOf, type Failure } from "@/lib/api/failure";
import { acceptPolicies, type PolicyStatus } from "@/lib/api/policy";
import { requireUser } from "@/lib/auth/session";

/** Accept the versions the person was shown and ticked (job CC, screen 7). Only a version string goes to the API; it answers 409 `policy_version_outdated` when it is no longer the current one. */
export async function acceptPoliciesAction(versions: { terms?: string; privacy?: string }): Promise<{ ok: true; data: PolicyStatus } | Failure> {
  const user = await requireUser();
  const t = appT(await getLang());
  const ok = (v: unknown) => v === undefined || (typeof v === "string" && /^[0-9A-Za-z.-]{1,40}$/.test(v));
  if (!versions || !ok(versions.terms) || !ok(versions.privacy) || (!versions.terms && !versions.privacy)) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    return { ok: true, data: await acceptPolicies(user.accessToken, versions) };
  } catch (error) {
    return failureOf(error, t);
  }
}
