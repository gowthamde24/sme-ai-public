"use client";

import * as React from "react";

import type { AiTeamView as Drawn } from "./AiTeamView";

/**
 * Today's shift (the lanes and the day's list) as a chunk of its own (the route-JS budget, owner 9 Nov 2026): it is the AI team page's second tab, and where the report scene is the page, the lanes are the part few people open first. A plain
 * dynamic import in an effect, like the helper panel: the lanes draw as soon as the chunk arrives (a moment after the page); a chunk that cannot load leaves the part out and never throws.
 */
export function AiTeamView(props: React.ComponentProps<typeof Drawn>) {
  const [Part, setPart] = React.useState<typeof Drawn | null>(null);
  React.useEffect(() => {
    let live = true;
    import("./AiTeamView").then((m) => live && setPart(() => m.AiTeamView), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  return Part && <Part {...props} />;
}
