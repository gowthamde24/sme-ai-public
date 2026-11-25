"use server";

import { revalidatePath } from "next/cache";

import type { Reply } from "@/components/v2/app/cc/kit";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiRequestError } from "@/lib/api/client";
import { describeJob } from "@/lib/api/jobs-describe";
import { patchJob, startSuggestion } from "@/lib/api/jobs";
import { KIND_KEYS, JOB_NAME_MAX, TELL_KINDS, TELL_TEXT_MAX, TELL_TEXT_MIN, isMode, isTellLang, withMode, type TellDraft, type TellMode } from "@/lib/jobs/tell";
import { mockStartedFor } from "@/lib/jobs/plan-mock";
import type { JobKind } from "@/lib/jobs/types";
import { tellScreens } from "@/lib/screens/flag";

import { DECIDERS, invalid } from "../retailers/finder-guard";
import { jobsWho } from "./guard";
import { jobsRefusal } from "./refusal";

/**
 * "Tell your assistant what to do" (TELL_SCREENS; Owner and Admin). `describeAction` READS the sentence into a draft and starts nothing; `turnOnAction` is the one thing that begins a job: the normal start (`POST /jobs {kind}`, with its approval rule) and then the
 * normal change (`PATCH /jobs/{id}` with the name and the choices the owner saw). Every input is checked first; the sentence is never logged; the API's own words never reach the screen (a closed code gets a sentence of ours).
 */
export type TellStarted = { jobId: string | null; /** the Owner's OK comes first (it is in Needs you on Today): nothing is on yet */ waiting: boolean; /** false = the job is on but some of the choices could not be saved: the job's page says what to check */ saved: boolean };

export async function describeAction(tenantId: string, input: { text: unknown; language: unknown; mode: unknown }): Promise<Reply<TellDraft>> {
  const lang = await getLang();
  const text = typeof input?.text === "string" ? input.text.trim() : "";
  if (tellScreens() === "off" || text.length < TELL_TEXT_MIN || text.length > TELL_TEXT_MAX || !isTellLang(input.language) || !(input.mode === null || isMode(input.mode))) return invalid(appT(lang), "jobs.tell.err.text");
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  const mode: TellMode | null = input.mode;
  const said = input.language === "any" ? lang : input.language;
  try {
    return { ok: true, data: await describeJob(ctx.token, tenantId, { text: withMode(text, mode), language: said, source: "typed" }, mode) };
  } catch (error) {
    if (error instanceof ApiRequestError && (error.code === "ai_limit" || error.reason === "ai_limit")) return { ok: false, kind: "rate_limited", code: "ai_limit", error: ctx.t("jobs.tell.err.ai_limit") };
    if (error instanceof ApiRequestError && error.code === "describe_unavailable") return { ok: false, kind: "unavailable", code: "describe_unavailable", error: ctx.t("jobs.tell.err.unavailable") };
    return jobsRefusal(error, ctx.t, lang);
  }
}

const closedKey = (k: string): boolean => /^[a-z][a-z0-9_]{0,40}$/.test(k);

export async function turnOnAction(tenantId: string, input: { kind: unknown; name: unknown; settings: unknown }): Promise<Reply<TellStarted>> {
  const lang = await getLang();
  const t = appT(lang);
  if (tellScreens() === "off") return invalid(t);
  const kind = input?.kind;
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const raw = typeof input?.settings === "object" && input.settings !== null && !Array.isArray(input.settings) ? (input.settings as Record<string, unknown>) : null;
  if (typeof kind !== "string" || !(TELL_KINDS as readonly string[]).includes(kind) || name.length > JOB_NAME_MAX || raw === null) return invalid(t);
  const allowed = KIND_KEYS[kind as JobKind];
  const settings: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!closedKey(k) || !allowed.includes(k) || !(typeof v === "boolean" || (typeof v === "string" && v.length <= 40))) return invalid(t);
    settings[k] = v;
  }
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  const mock = tellScreens() === "mock";
  let started;
  try {
    started = mock ? mockStartedFor(kind as JobKind) : await startSuggestion(ctx.token, tenantId, kind as JobKind);
  } catch (error) {
    return jobsRefusal(error, ctx.t, lang);
  }
  if ("approval" in started) return { ok: true, data: { jobId: null, waiting: true, saved: true } };
  let saved = true;
  if (!mock && (name !== "" || Object.keys(settings).length > 0)) {
    try {
      await patchJob(ctx.token, tenantId, started.jobId, { ...(name !== "" ? { name } : {}), ...(Object.keys(settings).length > 0 ? { settings } : {}) });
    } catch {
      saved = false; // the job started; its choices are the job's own page to check (the second factor, a refused value)
    }
  }
  revalidatePath(`/app/tenants/${tenantId}/jobs`);
  revalidatePath(`/app/tenants/${tenantId}`);
  return { ok: true, data: { jobId: started.jobId, waiting: false, saved } };
}
