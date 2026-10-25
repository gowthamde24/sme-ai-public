"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import type { PlanResult } from "@/lib/plan/types";

import type { Say } from "../words";

/** The error codes of a refused move, in the person's words (plan.err.*). */
export const errorLine = (t: Say, error: Extract<PlanResult, { ok: false }>["error"]): string => t(`plan.err.${error}`);

/** Runs one move: busy while it is out, then the screen is read again. A refusal says why in our words; a failure of the call itself says "try again". */
export function usePlanMove(t: Say) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (call: () => Promise<PlanResult>, then?: () => void) => {
    setBusy(true);
    setError(null);
    let r: PlanResult;
    try {
      r = await call();
    } catch {
      r = { ok: false, error: "invalid" };
    }
    setBusy(false);
    if (r.ok) {
      then?.();
      router.refresh();
    } else setError(errorLine(t, r.error));
  };
  return { busy, error, run };
}
