import type { AppT } from "@/i18n/app";

import { refusal, type Refused } from "../retailers/finder-guard";

/**
 * The refusals of the Jobs contract (FINAL 1.0, section 3 "New codes" and section 14 point 11) in our words: the API sends a closed code, the sentence is ours (`jobs.err.*`). Every other refusal keeps the sentence of its kind (`apierr.*`).
 * `approval_needed` of a start is NOT a refusal (lib/api/jobs.ts answers it as "waiting for your OK"); it is here only for the way a change of a job might meet it.
 */
export const JOBS_CODE_WORDS = {
  name_invalid: "jobs.err.name_invalid",
  setting_invalid: "jobs.err.setting_invalid",
  job_off_by_plan: "jobs.err.job_off_by_plan",
  job_unknown_kind: "jobs.err.job_unknown_kind",
  faq_not_allowed: "jobs.err.faq_not_allowed",
  consent_required: "jobs.err.consent_required",
  quiet_hours: "jobs.job.test.quiet",
  stopped_by_customer: "jobs.dnc.err.stopped",
  plan_expired: "jobs.err.plan_expired",
  approval_needed: "jobs.err.approval_needed",
} as const satisfies Record<string, Parameters<AppT>[0]>;

export function jobsRefusal(error: unknown, t: AppT, lang: string): Refused {
  const f = refusal(error, t, lang);
  const key = f.code && Object.hasOwn(JOBS_CODE_WORDS, f.code) ? JOBS_CODE_WORDS[f.code as keyof typeof JOBS_CODE_WORDS] : null;
  return key ? { ...f, error: t(key) } : f;
}
