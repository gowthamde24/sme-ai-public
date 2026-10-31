"use client";

import * as React from "react";

import type { Labels } from "@/components/v2/app/labels";

import type { InstallHint as Drawn } from "./InstallHint";

/**
 * The "Add to home screen" hint as a chunk of its own: it draws nothing on the server and nothing at all on most visits, so a page's first load does not carry it (the route-JS budget counts what a page loads at first). A plain dynamic import
 * in an effect (the loader of `next/dynamic` costs more than this wrapper); the hint's own effect starts when the chunk is in, which is straight after the page is up, before the browser's install prompt is offered.
 */
export function InstallHint({ labels }: { labels?: Labels }) {
  const [Part, setPart] = React.useState<typeof Drawn | null>(null);
  React.useEffect(() => void import("./InstallHint").then((m) => setPart(() => m.InstallHint)), []);
  return Part && <Part labels={labels} />;
}
