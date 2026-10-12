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
