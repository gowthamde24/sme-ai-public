import { CircleAlert } from "lucide-react";

import { jobGateKey, type PlanGate } from "@/lib/jobs/types";

import type { Say } from "../words";

/** A short note on a job that cannot run yet (`plan_gate`): "Needs a phone number first", "Connect WhatsApp first", "Free minutes used", "Billing needs a look". The words (and an icon) say it, never the colour alone. */
export function GateNote({ gate, t, className = "" }: { gate: PlanGate; t: Say; className?: string }) {
  return (
    <span data-part="job-gate" data-gate={gate} className={`flex items-center gap-1.5 text-sm font-semibold leading-snug text-ink ${className}`}>
      <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-amber-text" />
      {t(jobGateKey(gate))}
    </span>
  );
}
