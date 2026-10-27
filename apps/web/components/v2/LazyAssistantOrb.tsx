"use client";

import * as React from "react";

import type { AssistantOrb as Drawn } from "./AssistantOrb";

type Props = React.ComponentProps<typeof Drawn>;

/**
 * The orb's drawing code as a chunk of its own: a page that shows the circle draws its dark placeholder at once (CSS) and the ribbons start when the chunk arrives, so the route's first load does not carry it (the route-JS budget counts
 * what a page loads at first). A plain dynamic import in an effect, not `next/dynamic`: the loader of `next/dynamic` and its chunk cost more than this whole component, on every signed-in route. Nothing is drawn on the server.
 */
export function AssistantOrb(props: Props) {
  const [Part, setPart] = React.useState<typeof Drawn | null>(null);
  React.useEffect(() => void import("./AssistantOrb").then((m) => setPart(() => m.AssistantOrb)), []); // (a state set after the circle is gone is ignored by React)
  return Part && <Part {...props} />;
}
