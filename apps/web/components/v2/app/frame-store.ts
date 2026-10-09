"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { FrameData } from "./contract";

/**
 * Where the frame gets its numbers. The frame is drawn by the layout of /app, which cannot know which workspace the address is in; the layout of the workspace
 * (app/app/tenants/[tenantId]/layout.tsx) can. It reads the plan, the AI usage and the count on Today on the server and hands them to `<FrameDataSlot>`, which puts them here;
 * the menu, the bottom bar and the switcher read them with `useFrameData`. Browser only: nothing is ever stored on the server, so one person's numbers cannot reach another's page.
 */
let current: FrameData | null = null;
const listeners = new Set<() => void>();

function set(next: FrameData | null) {
  current = next;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The numbers the workspace layout brought in, else `fallback` (what the layout above gave: "still being read"). */
export function useFrameData(fallback: FrameData): FrameData {
  return useSyncExternalStore(subscribe, () => current, () => null) ?? fallback;
}

/** Renders nothing; while mounted, `data` is what the frame shows. */
export function FrameDataSlot({ data }: { data: FrameData }) {
  useEffect(() => {
    set(data);
    return () => set(null);
  }, [data]);
  return null;
}
