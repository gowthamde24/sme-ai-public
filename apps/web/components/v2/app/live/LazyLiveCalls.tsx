"use client";

import * as React from "react";

import type { Labels } from "../labels";

type Mod = typeof import("./LiveCallBar");
type Props = { tenantId: string; labels?: Labels; enabled: boolean };

let loading: Promise<Mod> | null = null;
/**
 * The live-call bar as a chunk of its own (like the orb): every signed-in page has it in its top bar, but nothing is drawn (and nothing asked) until the chunk has arrived after the page is up, so no route's first load carries it. A
 * plain dynamic import in an effect, not `next/dynamic` (its loader costs more than these parts). Only started where the frame says app v4 is on.
 */
function useLive(enabled: boolean): Mod | null {
  const [mod, setMod] = React.useState<Mod | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    loading ??= import("./LiveCallBar");
    let live = true;
    loading.then((m) => live && setMod(m), () => { loading = null; });
    return () => {
      live = false;
    };
  }, [enabled]);
  return enabled ? mod : null;
}
export function LiveBar(props: Props) {
  const m = useLive(props.enabled);
  return m ? <m.LiveBar {...props} /> : null;
}
export function LiveIsland(props: Props) {
  const m = useLive(props.enabled);
  return m ? <m.LiveIsland {...props} /> : null;
}
export function LivePing(props: Props) {
  const m = useLive(props.enabled);
  return m ? <m.LivePing {...props} /> : null;
}
