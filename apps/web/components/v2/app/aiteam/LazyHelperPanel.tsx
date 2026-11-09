"use client";

import * as React from "react";

import type { HelperPanel as Drawn } from "./HelperPanel";

/**
 * A helper's side panel as a chunk of its own (the route-JS budget): it opens only when a person taps a helper, so My AI team's first load does not carry it. A plain dynamic import in an effect, like the orb's (not `next/dynamic`, whose
 * loader costs more); the panel draws as soon as the chunk arrives (a moment after the tap, usually already fetched).
 */
export function HelperPanel(props: React.ComponentProps<typeof Drawn>) {
  const [Part, setPart] = React.useState<typeof Drawn | null>(null);
  React.useEffect(() => {
    let live = true;
    import("./HelperPanel").then((m) => live && setPart(() => m.HelperPanel), () => undefined); // (a chunk that cannot load leaves the part out; it never throws)
    return () => {
      live = false;
    };
  }, []);
  return Part && <Part {...props} />;
}
