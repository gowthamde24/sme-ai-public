"use client";

import { Suspense, lazy } from "react";

import type { SheetLoad, TemplateSeason } from "@/lib/jobs/templates";

import type { Words } from "../../words";
import type { SheetActions } from "./types";

/** The sheet is its own lazy chunk: Today and the Jobs page ship only the small button (their route-JS ceilings stay as they are). `loadSheet` is also called on the first touch of the button, so the chunk is there when the tap lands. */
export const loadSheet = () => import("./NewJobSheet");
const Sheet = lazy(loadSheet);

/** While the chunk arrives (a tap must answer at once): only the dimmed page. */
export function SheetVeil() {
  return <div aria-hidden="true" className="jb-veil fixed inset-0 z-[85] bg-black/45" />;
}

export function LazySheet({ words, base, actions, onClose, initial, initialAsk, initialSeason }: { words: Words; base: string; actions: SheetActions; onClose: () => void; initial?: SheetLoad | null; initialAsk?: string | null; initialSeason?: TemplateSeason | null }) {
  return (
    <Suspense fallback={<SheetVeil />}>
      <Sheet words={words} base={base} actions={actions} onClose={onClose} initial={initial} initialAsk={initialAsk} initialSeason={initialSeason} />
    </Suspense>
  );
}

