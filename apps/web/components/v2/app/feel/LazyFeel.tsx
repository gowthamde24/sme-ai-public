"use client";

import * as React from "react";

import type { FeelParts as Drawn } from "./FeelParts";

/** The chip and the watcher as a chunk of their own (the route-JS budget counts what every signed-in page loads first): an effect import after the page is up, only under app v4 (the caller draws it only then). */
export function FeelParts(props: React.ComponentProps<typeof Drawn>) {
  const [Part, setPart] = React.useState<typeof Drawn | null>(null);
  React.useEffect(() => void import("./FeelParts").then((m) => setPart(() => m.FeelParts)), []);
  return Part && <Part {...props} />;
}
