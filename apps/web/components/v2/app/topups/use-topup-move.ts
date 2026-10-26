"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import type { TopupResult } from "@/lib/topups/types";

import type { Say } from "../words";

/** Runs one move: busy while it is out, then the screen is read again. A refusal says why in our words (tu.err.*); a failure of the call itself says "not available". Resolves true when the move was accepted. */
export function useTopupMove(t: Say) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (call: () => Promise<TopupResult>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    let r: TopupResult;
    try {
      r = await call();
    } catch {
      r = { ok: false, error: "not_available" };
    }
    setBusy(false);
    if (r.ok) {
      router.refresh();
      return true;
    }
    setError(t(`tu.err.${r.error}`));
    return false;
  };
  return { busy, error, setError, run };
}
