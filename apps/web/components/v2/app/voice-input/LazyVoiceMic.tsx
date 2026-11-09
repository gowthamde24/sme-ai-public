"use client";

import * as React from "react";

import { NO_FRAME_DATA } from "../contract";
import { useFrameData } from "../frame-store";

type Mod = typeof import("./VoiceMic");
let loading: Promise<Mod> | null = null;

/**
 * The microphone as a chunk of its own (the route-JS budget counts what a page loads at first): nothing of voice typing is fetched until the page is up, and not at all unless the frame says app v4 is on. A plain dynamic import in an
 * effect, like the orb's. Until it arrives (a moment) the field simply has no microphone yet.
 */
export function VoiceMic(props: React.ComponentProps<Mod["VoiceMic"]>) {
  const v4 = useFrameData(NO_FRAME_DATA).v4 === true;
  const [mod, setMod] = React.useState<Mod | null>(null);
  React.useEffect(() => {
    if (!v4) return;
    loading ??= import("./VoiceMic");
    let live = true;
    loading.then((m) => live && setMod(m), () => { loading = null; });
    return () => {
      live = false;
    };
  }, [v4]);
  return v4 && mod ? <mod.VoiceMic {...props} /> : null;
}
