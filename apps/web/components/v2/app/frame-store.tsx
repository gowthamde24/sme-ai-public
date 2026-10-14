"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { moduleForPath } from "@/lib/packs/guard";

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

/**
 * The module guard for a MOVE inside the app (job CL). A typed address or a reload is judged on the server (the workspace's template answers the 403 page); a move by a link or the router does not run the server's
 * template again, so this part of the layout, which stays mounted, judges every new address against `modules` (the ones the workspace's layout read from the API): when the page's module is off it draws `fallback` (the
 * 403 page, made by the server in the person's language) instead of the page. It judges the path only (the home's `?tab=` pages are judged by the server on a reload; every business type has Customers and Leads today). The page's own reads still happen and the API and the database refuse regardless; this only keeps the screen honest.
 */
export function ModuleGate({ modules, fallback, children }: { modules: readonly string[]; fallback: ReactNode; children: ReactNode }) {
  const need = moduleForPath(usePathname() ?? "");
  return <>{need && !modules.includes(need.module) ? fallback : children}</>;
}
