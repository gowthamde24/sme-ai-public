"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { PREVIEW_COOKIE, PREVIEW_VALUE, previewAllowed } from "@/lib/screens/preview";

/**
 * Turn the preview of the JOBS and BILLING_V2 screens (sample data) on or off for THIS browser (staging only: anywhere else the environment does not allow it and this is a 404). A signed-in person only.
 * The choice is one cookie, not shared with anyone; nothing is saved on a server.
 */
export async function setPreviewAction(formData: FormData): Promise<void> {
  if (!previewAllowed()) notFound();
  await requireUser();
  const jar = await cookies();
  if (formData.get("on") === "1") jar.set(PREVIEW_COOKIE, PREVIEW_VALUE, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
  else jar.delete(PREVIEW_COOKIE);
  redirect("/app/preview");
}
