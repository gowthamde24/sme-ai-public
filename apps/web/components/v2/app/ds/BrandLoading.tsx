"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Mark } from "@/components/v2/Mark";

/** A page that takes longer than this to open shows the breathing orb; a faster one never flashes anything. */
export const LOADING_AFTER_MS = 300;
/** Whatever happens, the orb stops breathing after this (a link that never opened). */
const GIVE_UP_MS = 15_000;

const here = (): string => `${location.pathname}${location.search}`;

/**
 * The branded loading of the Jobs design system (owner 19 Nov): while the next page loads, the floating orb breathes (a soft scale and a ring that fades: transform and opacity only, design/jobs.css), after 300 ms so a fast page never flashes it.
 * The page itself shows its own skeleton (loading.tsx), never a blank screen or a spinner. It listens for a click on a link inside this app and clears itself when the address changes; no routing code is touched.
 */
export function NavLoading() {
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.removeAttribute("data-nav-loading");
  }, [pathname]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(timer);
      clearTimeout(giveUp);
      document.documentElement.removeAttribute("data-nav-loading");
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || `${url.pathname}${url.search}` === here()) return;
      clear();
      const from = here();
      timer = setTimeout(() => {
        if (here() === from) document.documentElement.setAttribute("data-nav-loading", "");
      }, LOADING_AFTER_MS);
      giveUp = setTimeout(clear, GIVE_UP_MS);
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", clear);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", clear);
      clear();
    };
  }, []);
  return null;
}

/** The brand mark on the first open of a session: under 600 ms (fade and scale), over the page, never taking a tap (pointer-events none), never for a person who asked for less motion, and never again until the tab is closed. */
export function FirstOpenMark() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem("s19-opened") === "1";
      sessionStorage.setItem("s19-opened", "1");
    } catch {
      seen = true; // no storage: do not show it on every page
    }
    if (seen || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const on = setTimeout(() => setShow(true), 0);
    const off = setTimeout(() => setShow(false), 650);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, []);
  if (!show) return null;
  return (
    <div className="jb-intro" data-part="first-open-mark" aria-hidden="true">
      <Mark px={72} />
    </div>
  );
}

export function BrandLoading() {
  return (
    <>
      <NavLoading />
      <FirstOpenMark />
    </>
  );
}

export default BrandLoading;
