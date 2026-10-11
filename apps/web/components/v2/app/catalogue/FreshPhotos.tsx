"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * Photo links run out (ten minutes). The page is read again BEFORE they do: this part asks the router to refresh the page's data at three quarters of the shortest life of the links on it (and again
 * every time that passes), when the tab is showing; a tab that was hidden and comes back past that point refreshes at once. A photo that fails to load asks for the same (at most once every 20 seconds).
 * The refresh keeps what the person has typed or picked: only the data from the server changes.
 */
const MIN_SECONDS = 30;
const RETRY_MS = 20_000;

type Refresher = { request: () => void };
const Ctx = React.createContext<Refresher>({ request: () => {} });
export const usePhotoRefresh = (): Refresher => React.useContext(Ctx);

export function FreshPhotos({ seconds, children }: { seconds: number | null; children: React.ReactNode }) {
  const router = useRouter();
  const last = React.useRef(0); // when the links were last made fresh (page load or a refresh)
  const asked = React.useRef(0); // when a photo that failed to load last asked for a refresh
  const refresh = React.useCallback(() => {
    last.current = Date.now();
    asked.current = Date.now();
    router.refresh();
  }, [router]);
  const request = React.useCallback(() => {
    if (Date.now() - asked.current >= RETRY_MS && (typeof document === "undefined" || document.visibilityState !== "hidden")) refresh();
  }, [refresh]);
  const value = React.useMemo(() => ({ request }), [request]);

  React.useEffect(() => {
    if (seconds === null) return;
    last.current = Date.now();
    const every = Math.max(MIN_SECONDS, Math.floor(seconds * 0.75)) * 1000;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, every);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= every) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [seconds, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
