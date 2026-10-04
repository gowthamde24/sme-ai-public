"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, createTenant } from "@/lib/api/client";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const user = await requireUser();

  const name = field(formData, "name");
  const slug = field(formData, "slug");
  if (name.length < 1 || name.length > 120)
    return { error: "Enter a name (up to 120 characters)." };
  if (!SLUG.test(slug)) {
    return {
      error:
        "URL name must be 3-40 characters: lowercase letters, digits and hyphens.",
    };
  }

  let failure: TenantFormState;
  try {
    await createTenant(user.accessToken, name, slug);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 409) {
      failure = { error: "That URL name is not available." };
    } else if (error instanceof ApiRequestError && error.status === 422) {
      failure = { error: "Check the name and URL name and try again." };
    } else {
      failure = { error: "Could not create the workspace. Try again." };
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
