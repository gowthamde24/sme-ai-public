"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Settings > Security > "Sign out of all devices": ends EVERY session of this account (this browser, the phone, anywhere a refresh token is still alive), not only this one. Supabase's `scope: "global"` revokes the refresh tokens; an access
 * token already issued lives out its short life (an hour at most), which is why the screen says "within the hour". Then the person is sent to the sign-in page with a note. A failure is not hidden: the person stays on the page, still
 * signed in, and the screen says it did not work (nothing was changed).
 */
export async function signOutEverywhereAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) redirect("?section=security&signout=failed");
  redirect("/login?notice=everywhere");
}
