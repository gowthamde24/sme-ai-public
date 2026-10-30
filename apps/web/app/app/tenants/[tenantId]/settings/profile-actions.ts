"use server";

import { revalidatePath } from "next/cache";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { patchMyProfile, removeMyPicture, uploadMyPicture } from "@/lib/api/me";
import { PROFILE_LANGUAGES } from "@/lib/api/profile";
import { requireUser } from "@/lib/auth/session";
import { pictureProblem } from "@/lib/picture";

export type MyProfileState = { ok: true } | { ok: false; error: "invalid" | "toobig" | "kind" | "failed" | "session" } | undefined;

/** Any member's own name and language (Settings > My profile). The name is 1 to 100 letters; the language one the API knows. Only the fields that came are sent. */
export async function saveMyProfileAction(tenantId: string, _prev: unknown, formData: FormData): Promise<MyProfileState> {
  const name = String(formData.get("display_name") ?? "").trim();
  const language = String(formData.get("language") ?? "");
  const address = formData.has("address_as") ? String(formData.get("address_as") ?? "").replace(/\s+/g, " ").trim() : null; // only when the screen had the field (the API has it); "" clears it
  if ((address !== null && address.length > 30) || name.length < 1 || name.length > 100 || !(PROFILE_LANGUAGES as readonly string[]).includes(language) || !isCanonicalUuid(tenantId)) return { ok: false, error: "invalid" };
  try {
    const user = await requireUser();
    await patchMyProfile(user.accessToken, tenantId, { display_name: name, language, ...(address === null ? {} : { address_as: address }) });
    revalidatePath(`/app/tenants/${tenantId}`, "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) return { ok: false, error: "session" };
    return { ok: false, error: error instanceof ApiRequestError && error.status === 422 ? "invalid" : "failed" };
  }
}

/** The member's own picture: a `picture` file (JPG, PNG or WebP, up to 5 MB, sent as the body; the API makes the sizes) or `remove=1` (then the Google photo shows again, if there is one). */
export async function pictureAction(tenantId: string, _prev: unknown, formData: FormData): Promise<MyProfileState> {
  const remove = formData.get("remove") === "1";
  const file = formData.get("picture");
  const problem = remove ? null : pictureProblem(file);
  if (problem) return { ok: false, error: problem };
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "invalid" };
  try {
    const user = await requireUser();
    if (remove) await removeMyPicture(user.accessToken, tenantId);
    else await uploadMyPicture(user.accessToken, tenantId, await (file as File).arrayBuffer(), (file as File).type);
    revalidatePath(`/app/tenants/${tenantId}`, "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) return { ok: false, error: "session" };
    if (error instanceof ApiRequestError) {
      if (error.status === 413) return { ok: false, error: "toobig" };
      if (error.status === 415) return { ok: false, error: "kind" };
      if (error.status === 422) return { ok: false, error: "invalid" };
    }
    return { ok: false, error: "failed" };
  }
}
