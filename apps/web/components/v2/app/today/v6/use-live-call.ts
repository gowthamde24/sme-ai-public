"use client";

import * as React from "react";

import { NO_FRAME_DATA } from "../../contract";
import { useFrameData } from "../../frame-store";
import { useLiveCalls } from "../../live/live-calls-store";

/** A call on the line, as the band's first line draws it: who, how long, and where its own page is (null id = the made-up call of staging). */
export type LiveCallNow = { id: string | null; caller: string; seconds: number };

/**
 * The call that is live now (the band's eyebrow turns red: "On a call · <name> · 1:24 · Listen"). The real one comes from the workspace's live-call poll (shared with the menu and the top bar: one poll); `mock` (CALL_SCREENS=mock and `?live=1`) is a made-up call for staging. null = no call.
 * The clock counts on from the API's own elapsed seconds.
 */
export function useLiveCall(tenantId: string, mock: { caller: string } | null): LiveCallNow | null {
  const frame = useFrameData(NO_FRAME_DATA);
  const polled = useLiveCalls(tenantId, frame.live && mock === null);
  const [t0] = React.useState(() => Date.now());
  const [clockNow, setClockNow] = React.useState(t0);
  const live = mock !== null || polled.calls.length > 0;
  React.useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  if (mock) return { id: null, caller: mock.caller, seconds: 72 + Math.max(0, Math.floor((clockNow - t0) / 1000)) };
  const first = polled.calls[0];
  if (!first) return null;
  const since = polled.at > 0 ? Math.max(0, Math.floor((clockNow - polled.at) / 1000)) : 0;
  return { id: first.id, caller: first.who, seconds: first.elapsedS + since };
}
