"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { backoffDelay } from "@/lib/net/backoff";

import { word } from "../labels";
import { useLabels } from "./labels-context";
import { useOnline } from "./use-online";

/** Automatic tries are few and far between: at most this many inside the window, however often the error screen is drawn again (so a broken page never hammers the server). */
const AUTO_TRIES = 2;
const WINDOW_MS = 60_000;
const attempts: number[] = [];
function takeAutoTry(now: number): number | null {
  while (attempts.length && now - attempts[0] > WINDOW_MS) attempts.shift();
  if (attempts.length >= AUTO_TRIES) return null;
  attempts.push(now);
  return attempts.length - 1;
}
/** For a test: forget the automatic tries. */
export const resetAutoTries = (): void => void (attempts.length = 0);

const button = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-brand-edge bg-brand px-6 text-base font-bold text-on-brand hover:brightness-95";

/**
 * "Try again" (job BW). With `auto` it also tries by itself, after 4 and then 8 seconds (a little jittered), only while the device is online and the tab is in front, and says so ("Trying again in 4 s…");
 * the person can press the button at any moment. `onRetry` is what the page gives: Next's retry for an error boundary, a refresh for a page.
 */
export function RetryButton({ onRetry, auto = false }: { onRetry: () => void; auto?: boolean }) {
  const labels = useLabels();
  const online = useOnline();
  const [left, setLeft] = useState<number | null>(null);
  const retry = useRef(onRetry);
  useEffect(() => {
    retry.current = onRetry;
  });

  useEffect(() => {
    if (!auto || !online) return;
    const attempt = takeAutoTry(Date.now());
    if (attempt === null) return;
    const total = Math.ceil(backoffDelay(attempt, { base: 4000, cap: 16_000 }) / 1000);
    let remaining = total;
    const first = setTimeout(() => setLeft(remaining), 0);
    const tick = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) return setLeft(remaining);
      clearInterval(tick);
      setLeft(null);
      if (document.visibilityState === "visible") retry.current();
    }, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      setLeft(null);
    };
  }, [auto, online]);

  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" data-repeat="" onClick={() => onRetry()} className={button}>
        <RefreshCw className="size-5" aria-hidden="true" />
        {word(labels, "problem.retry", "Try again")}
      </button>
      <p role="status" className="min-h-5 text-sm text-muted">
        {left !== null ? word(labels, "problem.retrying", "Trying again in {n} s…", { n: left }) : ""}
      </p>
    </div>
  );
}

/** "Try again" for a page that could not read its data: loads the page again from the server (a plain reload: it needs no router, so it works in any page, and a failed page starts clean). With `auto` it also tries once or twice by itself. */
export function RefreshRetry({ auto = false }: { auto?: boolean }) {
  return <RetryButton auto={auto} onRetry={() => window.location.reload()} />;
}
