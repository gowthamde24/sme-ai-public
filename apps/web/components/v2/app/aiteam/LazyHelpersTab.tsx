"use client";

import * as React from "react";

import type { HelpersTab as Drawn } from "./HelpersTab";

/** The Helpers tab as a chunk of its own (the route-JS budget): only the person who opens that tab loads it. A plain dynamic import in an effect, like the orb's. */
export function HelpersTab(props: React.ComponentProps<typeof Drawn>) {
  const [Part, setPart] = React.useState<typeof Drawn | null>(null);
  React.useEffect(() => void import("./HelpersTab").then((m) => setPart(() => m.HelpersTab)), []);
  return Part && <Part {...props} />;
}
