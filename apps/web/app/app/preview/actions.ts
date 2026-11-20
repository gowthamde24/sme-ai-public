"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { choiceOfWord, PREVIEW_COOKIE, previewAllowed, previewValue } from "@/lib/screens/preview";

/**
 * Turn the preview of the JOBS and BILLING_V2 screens on or off for THIS browser (staging only: anywhere else the environment does not allow it and this is a 404). A signed-in person only.
 * `on=1` turns it on with the chosen business (`choice`: "mine" = my own business, real data where it exists, or one sample business word; an unknown word is "mine"); anything else turns it off.
 * The choice is one cookie, not shared with anyone; nothing is saved on a server.
 */
export async function setPreviewAction(formData: FormData): Promise<void> {
  if (!previewAllowed()) notFound();
  await requireUser();
  const jar = await cookies();
  if (formData.get("on") === "1") jar.set(PREVIEW_COOKIE, previewValue(choiceOfWord(formData.get("choice"))), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
  else jar.delete(PREVIEW_COOKIE);
  redirect("/app/preview");
}
