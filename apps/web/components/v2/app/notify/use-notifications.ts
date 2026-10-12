"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { parseNotices, type Notice } from "@/lib/notifications/model";
import { nextDelay } from "@/lib/notifications/schedule";

export type NotifyStatus = "loading" | "ok" | "error" | "signed_out";

/** A good answer older than this is asked for again at once when the tab comes back to the front. */
const STALE_MS = 20_000;

/**
 * The bell's data (job BU): asks `/app/tenants/<id>/notifications` now and then, by the rule in lib/notifications/schedule.ts: every minute while the tab is in front, longer after each failure (up to ten
 * minutes), not at all while the tab is hidden (unless browser notifications are on: then every five minutes) or while the phone is offline, and straight away when the tab or the connection comes back.
 * One question at a time; leaving the page stops it. A rejected session (401) stops it for good: the page sends the person to sign in on its next move. `onFresh` gets each good answer.
 */
export function useNotifications(tenantId: string, browserOptIn: boolean, onFresh: (items: Notice[]) => void) {
  const base = `/app/tenants/${tenantId}`;
  const [items, setItems] = useState<Notice[]>([]);
  const [status, setStatus] = useState<NotifyStatus>("loading");
  const optIn = useRef(browserOptIn);
  const fresh = useRef(onFresh);
  const askNow = useRef<() => void>(() => undefined);
  useEffect(() => {
    optIn.current = browserOptIn;
    fresh.current = onFresh;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let failures = 0;
    let last = 0;
    let stopped = false;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (stopped) return;
      const wait = nextDelay({ failures, hidden: document.hidden, online: navigator.onLine, browserOptIn: optIn.current });
      if (wait !== null) timer = setTimeout(() => void run(), wait);
    };
    const run = async () => {
      if (stopped || controller) return;
      controller = new AbortController();
      try {
        const res = await fetch(`${base}/notifications`, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
        if (res.status === 401) {
          stopped = true;
          setStatus("signed_out");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const list = parseNotices(await res.json(), base);
        failures = 0;
        last = Date.now();
        setItems(list);
        setStatus("ok");
        fresh.current(list);
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        failures += 1;
        setStatus("error");
      } finally {
        controller = null;
        schedule();
      }
    };
    askNow.current = () => void run();
    const onVisible = () => {
      if (document.hidden) schedule();
      else if (Date.now() - last > STALE_MS) void run();
      else schedule();
    };
    const onNet = () => (navigator.onLine && Date.now() - last > STALE_MS ? void run() : schedule());
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onNet);
    window.addEventListener("offline", schedule);
    if (!document.hidden || optIn.current) void run();
    else schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onNet);
      window.removeEventListener("offline", schedule);
    };
  }, [base]);

  const refresh = useCallback(() => askNow.current(), []);
  return { items, status, refresh };
}
