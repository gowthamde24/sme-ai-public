import { AlertTriangle, Check, Clock, Info } from "lucide-react";
import type { ReactNode } from "react";

/** The ONE status chip of the Jobs design system (design/jobs.css, JOBS on): solid, one shape and size on cards, plan cards, toasts and lists. Done = green with a check, Waiting = amber, Failed = red, Info = neutral. An icon always sits with the word, so colour is never the only sign. The word is passed in, in the person's language. */
export const JOB_TONES = ["done", "wait", "fail", "info"] as const;
export type JobTone = (typeof JOB_TONES)[number];
const ICON = { done: Check, wait: Clock, fail: AlertTriangle, info: Info } as const;

export function JobChip({ tone, children, className = "" }: { tone: JobTone; children: ReactNode; className?: string }) {
  const Icon = ICON[tone];
  return (
    <span data-tone={tone} className={`jb-chip ${className}`.trim()}>
      <Icon aria-hidden="true" />
      {children}
    </span>
  );
}
