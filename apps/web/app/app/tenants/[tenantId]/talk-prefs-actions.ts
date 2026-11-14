"use server";

import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { loadTalkPrefs, previewOption, saveTalkPrefs, undoTalkChange, type Fail, type Out, type Sample } from "@/lib/talk-prefs/source";
import type { TalkPrefs } from "@/lib/talk-prefs/types";

/**
 * "How it talks to you" (owner item G): any signed-in member of the workspace changes THEIR OWN way of being talked to (the choices belong to the user, not the business; the API takes the user from the token). The
 * tenant id here only proves the person is a member of the workspace the screen is in. The answers are codes (`Fail`), never the API's words: the screen has the sentence for each.
 */
export type { Fail, Sample };
export type PrefsResult = Out<TalkPrefs>;
export type PreviewResult = Out<Sample>;

async function member(tenantId: string): Promise<string | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    await fetchTenant(user.accessToken, tenantId);
    return user.accessToken;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

export async function loadTalkPrefsAction(tenantId: string, language: unknown): Promise<PrefsResult> {
  const token = await member(tenantId);
  return token ? loadTalkPrefs(token, language) : { ok: false, error: "not_available" };
}

export async function saveTalkPrefsAction(tenantId: string, language: unknown, patch: unknown): Promise<PrefsResult> {
  const token = await member(tenantId);
  return token ? saveTalkPrefs(token, language, patch) : { ok: false, error: "not_available" };
}

export async function undoTalkPrefsAction(tenantId: string, language: unknown, undoToken: unknown): Promise<PrefsResult> {
  const token = await member(tenantId);
  return token ? undoTalkChange(token, language, undoToken) : { ok: false, error: "not_available" };
}

export async function previewTalkPrefsAction(tenantId: string, language: unknown, option: unknown): Promise<PreviewResult> {
  const token = await member(tenantId);
  return token ? previewOption(token, language, option) : { ok: false, error: "not_available" };
}
