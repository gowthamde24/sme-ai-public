"use client";

import * as React from "react";

import { useLiveCalls } from "../../live/live-calls-store";
import type { LiveCallSeed } from "./types";

/** A call on the line, as the band's eyebrow draws it: who, how long, and where its own page is (null id = the made-up call of staging). */
export type LiveCallNow = { id: string | null; caller: string; seconds: number };

/**
 * The call that is live now (the band's eyebrow turns red: "On a call · <name> · 1:24 · Listen", and the newest dot of "Your day" pulses). Two sources of the SAME fact: the calls list the page read when it was drawn (`seed`: the reader the Calls page's live strip uses, status live), which
 * shows at once; and the workspace's live-call poll (shared with the menu and the top bar: one poll), which takes over as soon as it has answered, so a call that ended goes away. `mock` (CALL_SCREENS=mock and `?live=1`) is a made-up call for staging. null = no call.
 * The clock counts on from the API's own elapsed seconds.
 */
export function useLiveCall(tenantId: string, mock: { caller: string } | null, seed: readonly LiveCallSeed[] = []): LiveCallNow | null {
  const polled = useLiveCalls(tenantId, mock === null);
  const [t0] = React.useState(() => Date.now());
  const [clockNow, setClockNow] = React.useState(t0);
  const answered = polled.status === "ok" && polled.at > 0;
  const first = answered ? polled.calls[0] : (seed[0] ?? null);
  const live = mock !== null || first !== undefined && first !== null;
  React.useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  if (mock) return { id: null, caller: mock.caller, seconds: 72 + Math.max(0, Math.floor((clockNow - t0) / 1000)) };
  if (!first) return null;
  const from = answered ? polled.at : t0;
  return { id: first.id, caller: first.who, seconds: first.elapsedS + Math.max(0, Math.floor((clockNow - from) / 1000)) };
}
