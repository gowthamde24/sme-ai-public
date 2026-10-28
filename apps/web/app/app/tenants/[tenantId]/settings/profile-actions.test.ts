import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const requireUser = vi.fn();
const patchMyProfile = vi.fn();
const uploadMyPicture = vi.fn();
const removeMyPicture = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/me", () => ({ patchMyProfile: (...a: unknown[]) => patchMyProfile(...a), uploadMyPicture: (...a: unknown[]) => uploadMyPicture(...a), removeMyPicture: (...a: unknown[]) => removeMyPicture(...a) }));

import { pictureAction, saveMyProfileAction } from "./profile-actions";

const T = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const file = (type: string, size = 10) => new File([new Uint8Array(size)], "me", { type });

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ accessToken: "tok" });
});

describe("Settings > My profile: name and language", () => {
  it("saves the person's own name and language and reads the pages again so the menu shows them", async () => {
    expect(await saveMyProfileAction(T, undefined, form({ display_name: "  Ravi K  ", language: "te" }))).toEqual({ ok: true });
    expect(patchMyProfile).toHaveBeenCalledWith("tok", T, { display_name: "Ravi K", language: "te" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`, "layout");
  });
  it.each([["no name", { display_name: " ", language: "en" }], ["a name over 100 letters", { display_name: "x".repeat(101), language: "en" }], ["a language the API does not know", { display_name: "Ravi", language: "xx" }]])("%s is refused before any request", async (_w, o) => {
    expect(await saveMyProfileAction(T, undefined, form(o))).toEqual({ ok: false, error: "invalid" });
    expect(patchMyProfile).not.toHaveBeenCalled();
  });
  it("a rejected session, a 422 and any other failure each get their own answer", async () => {
    patchMyProfile.mockRejectedValueOnce(new ApiAuthError());
    expect(await saveMyProfileAction(T, undefined, form({ display_name: "Ravi", language: "en" }))).toEqual({ ok: false, error: "session" });
    patchMyProfile.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "x"));
    expect(await saveMyProfileAction(T, undefined, form({ display_name: "Ravi", language: "en" }))).toEqual({ ok: false, error: "invalid" });
    patchMyProfile.mockRejectedValueOnce(new Error("down"));
    expect(await saveMyProfileAction(T, undefined, form({ display_name: "Ravi", language: "en" }))).toEqual({ ok: false, error: "failed" });
  });
});

describe("Settings > My profile: the picture", () => {
  it("sends the picture as it is with its own type", async () => {
    const f = new FormData();
    f.append("picture", file("image/jpeg"));
    expect(await pictureAction(T, undefined, f)).toEqual({ ok: true });
    expect(uploadMyPicture).toHaveBeenCalledWith("tok", T, expect.any(ArrayBuffer), "image/jpeg");
  });
  it("no file, a big file or another type is refused before any request", async () => {
    const none = new FormData();
    expect(await pictureAction(T, undefined, none)).toEqual({ ok: false, error: "invalid" });
    const big = new FormData();
    big.append("picture", file("image/png", 5 * 1024 * 1024 + 1));
    expect(await pictureAction(T, undefined, big)).toEqual({ ok: false, error: "toobig" });
    const gif = new FormData();
    gif.append("picture", file("image/gif"));
    expect(await pictureAction(T, undefined, gif)).toEqual({ ok: false, error: "kind" });
    expect(uploadMyPicture).not.toHaveBeenCalled();
  });
  it("removing needs no file; the API's refusals map to the closed sentences", async () => {
    expect(await pictureAction(T, undefined, form({ remove: "1" }))).toEqual({ ok: true });
    expect(removeMyPicture).toHaveBeenCalledWith("tok", T);
    const f = new FormData();
    f.append("picture", file("image/png"));
    uploadMyPicture.mockRejectedValueOnce(new ApiRequestError(415, "image_rejected", "x"));
    expect(await pictureAction(T, undefined, f)).toEqual({ ok: false, error: "kind" });
    uploadMyPicture.mockRejectedValueOnce(new ApiAuthError());
    expect(await pictureAction(T, undefined, f)).toEqual({ ok: false, error: "session" });
  });
});
