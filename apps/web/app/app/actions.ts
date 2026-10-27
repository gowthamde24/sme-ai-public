"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, createTenant } from "@/lib/api/client";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverT } from "@/i18n/server-t";

export type TenantFormState = { error?: string } | undefined;

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function createTenantAction(
  _prev: TenantFormState,
  formData: FormData,
): Promise<TenantFormState> {
  const t = await serverT(["acct."]);
  const user = await requireUser();

  const name = field(formData, "name");
  const slug = field(formData, "slug");
  if (name.length < 1 || name.length > 120)
    return { error: t("acct.enter_a_name_up_to_120") };
  if (!SLUG.test(slug)) {
    return {
      error:
        t("acct.url_name_must_be_3_40"),
    };
  }

  let failure: TenantFormState;
  try {
    await createTenant(user.accessToken, name, slug);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (
      error instanceof ApiRequestError &&
      error.code === "workspace_limit_reached"
    ) {
      // The free trial includes one workspace per owner (job AD, D1). The API's sentence is fixed and plain.
      failure = { error: error.message };
    } else if (error instanceof ApiRequestError && error.status === 409) {
      failure = { error: t("acct.that_url_name_is_not_available") };
    } else if (error instanceof ApiRequestError && error.status === 422) {
      failure = { error: t("acct.check_the_name_and_url_name") };
    } else {
      failure = { error: t("acct.could_not_create_the_workspace_try") };
    }
  }
  if (failure) return failure;

  revalidatePath("/app");
  redirect("/app");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

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
