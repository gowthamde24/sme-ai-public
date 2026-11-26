"use client";

import { Suspense, lazy } from "react";

import type { SellEntry, SellStyle } from "@/lib/sell/types";

import type { Words } from "../words";
import type { ImportTarget, SellActions, Work } from "./types";

/** The sheet, the Say it box and the "I understood" card are one lazy chunk: the page ships only the buttons and the rows (the route-JS ceilings stay as they are). `loadWork` is also called on the first touch of a button, so the chunk is there when the tap lands. */
export const loadWork = () => import("./SellWork");
const Work_ = lazy(loadWork);

/** While the chunk arrives (a tap must answer at once): only the dimmed page. */
export function WorkVeil() {
  return <div aria-hidden="true" className="sl-veil fixed inset-0 z-[85] bg-black/45" />;
}

export function LazyWork(props: { targets?: ImportTarget[]; style: SellStyle; work: Work; words: Words; base: string; actions: SellActions; live: boolean; ownerPrice: boolean; paths: { photos: string | null; sheet: string | null }; onClose: () => void; onSaved: (e: SellEntry) => void; onRemoved?: (id: string) => void }) {
  return (
    <Suspense fallback={<WorkVeil />}>
      <Work_ {...props} />
    </Suspense>
  );
}
