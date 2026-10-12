"use server";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { createCalendarFeed, revokeCalendarFeed, type NewCalendarFeed } from "@/lib/api/data";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf, type Failure } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";

/**
 * Settings > Data, the two things a person does to their own calendar address (job CC). Any member may; the API makes the address for the person who asks and keeps only a hash of it, so the address in the answer is the only
 * time it can be seen. It is returned to the page that asked and nowhere else: not logged, not put in a path, not revalidated into any page.
 */
export async function makeCalendarFeedAction(tenantId: string): Promise<{ ok: true; feed: NewCalendarFeed } | Failure> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!isCanonicalUuid(tenantId)) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    return { ok: true, feed: await createCalendarFeed(user.accessToken, tenantId) };
  } catch (error) {
    return failureOf(error, t);
  }
}

export async function revokeCalendarFeedAction(tenantId: string): Promise<{ ok: true } | Failure> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!isCanonicalUuid(tenantId)) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    await revokeCalendarFeed(user.accessToken, tenantId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, t);
  }
}
