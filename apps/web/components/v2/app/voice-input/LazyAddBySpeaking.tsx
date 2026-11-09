"use client";

import * as React from "react";

import { NO_FRAME_DATA } from "../contract";
import { useFrameData } from "../frame-store";

type Mod = typeof import("./AddBySpeaking");
let loading: Promise<Mod> | null = null;

/** "Add by speaking" as a chunk of its own, loaded only under app v4 once the page is up (the route-JS budget). */
export function AddBySpeaking(props: React.ComponentProps<Mod["AddBySpeaking"]>) {
  const v4 = useFrameData(NO_FRAME_DATA).v4 === true;
  const [mod, setMod] = React.useState<Mod | null>(null);
  React.useEffect(() => {
    if (!v4) return;
    loading ??= import("./AddBySpeaking");
    let live = true;
    loading.then((m) => live && setMod(m), () => { loading = null; });
    return () => {
      live = false;
    };
  }, [v4]);
  return v4 && mod ? <mod.AddBySpeaking {...props} /> : null;
}
