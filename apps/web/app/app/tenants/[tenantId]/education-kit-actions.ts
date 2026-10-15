import { redirect } from "next/navigation";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { requireUser } from "@/lib/auth/session";

import { eduRefusalOf } from "./education-kit";

export type Failed = { ok: false; error: string; mfa?: boolean };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day written yyyy-mm-dd (not 30 February). */
export const validDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

export async function context() {
  const user = await requireUser();
  return { user, t: appT(await getLang()) };
}
export type Ctx = Awaited<ReturnType<typeof context>>;

/** A refusal as OUR sentence; a rejected session goes to sign-in (for every server action of the education screens). */
export function failed(error: unknown, t: Ctx["t"]): Failed {
  try {
    const r = eduRefusalOf(error);
    return { ok: false, error: t(r.key as "today.err.generic"), ...(r.mfa ? { mfa: true } : {}) };
  } catch (e) {
    if (e instanceof ApiAuthError) redirect("/login");
    throw e;
  }
}
