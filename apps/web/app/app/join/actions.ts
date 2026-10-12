"use server";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { failureOf, type Failure } from "@/lib/api/failure";
import { acceptInvitation, type Joined } from "@/lib/api/team";
import { requireUser } from "@/lib/auth/session";

/**
 * Join a business with a code (job CC, screen 4). Any signed-in person. The code goes to the API as typed (the API forgives case, spaces, hyphens and look-alike letters) and is not logged. A wrong, used, expired or
 * revoked code is ONE answer; five wrong ones lock the person for an hour; an Admin invitation needs the second factor for this sign-in.
 */
export async function acceptInvitationAction(code: string): Promise<{ ok: true; data: Joined } | Failure> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (typeof code !== "string" || code.trim().length < 1 || code.length > 100) return { ok: false, kind: "invalid", error: t("apierr.invalid"), code: "invitation_invalid" };
  try {
    return { ok: true, data: await acceptInvitation(user.accessToken, code) };
  } catch (error) {
    return failureOf(error, t);
  }
}
