"use client";

import { Share, X } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { word, type Labels } from "@/components/v2/app/labels";
import { SHORT_NAME } from "@/design/brand";
import { OwlSvg } from "@/components/v2/app/owl/OwlSvg";
import { EMPTY, HINT_KEY, dismiss, howTo, markInstalled, parseState, recordVisit, shouldShow, type HintState, type HowTo } from "@/lib/pwa/install-hint";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function read(): HintState {
  try {
    return parseState(window.localStorage.getItem(HINT_KEY));
  } catch {
    return EMPTY;
  }
}
function write(state: HintState): void {
  try {
    window.localStorage.setItem(HINT_KEY, JSON.stringify(state));
  } catch {
    // storage is blocked (a private window): the hint simply cannot remember, it still works for this visit
  }
  listeners.forEach((l) => l());
}

// The hint's state lives in the browser (storage, the install event, the screen), so it is read through useSyncExternalStore: the server draws nothing, the browser decides after hydration.
const listeners = new Set<() => void>();
let deferred: InstallPrompt | null = null;
function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}
/** "" = no hint, else how this phone adds an app (a primitive, so React can compare it). */
function snapshot(): HowTo | "" {
  if (typeof window === "undefined") return "";
  const phone = window.matchMedia("(max-width: 767px)").matches && window.matchMedia("(pointer: coarse)").matches;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return shouldShow(read(), { phone, standalone }, Date.now()) ? howTo(navigator.userAgent, deferred !== null) : "";
}

/**
 * A gentle, dismissible "Add to home screen" hint on a phone (job BL), above the bottom bar. It appears from the third visit, never in the installed app, and "Not now" keeps it away for 30 days.
 * Chrome-like browsers get an "Add" button that opens their own install sheet; Safari on iPhone is told to use Share, then "Add to Home Screen"; others are pointed at the browser menu. It sends nothing
 * and decides nothing: the count and the choice stay on this device (lib/pwa/install-hint.ts).
 */
export function InstallHint({ labels }: { labels?: Labels }) {
  const how = useSyncExternalStore(subscribe, snapshot, () => "");

  useEffect(() => {
    // this page view counts as a visit (the frame is drawn once per page load; only 30 minutes after the last one is a new visit)
    write(recordVisit(read(), Date.now()));
    const onPrompt = (e: Event) => {
      e.preventDefault(); // we draw our own button, at the moment we chose
      deferred = e as InstallPrompt;
      listeners.forEach((l) => l());
    };
    const onInstalled = () => write(markInstalled(read()));
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!how) return null;
  const later = () => write(dismiss(read(), Date.now()));
  const add = async () => {
    const prompt = deferred;
    if (!prompt) return;
    deferred = null;
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    write(choice?.outcome === "accepted" ? markInstalled(read()) : dismiss(read(), Date.now()));
  };
  return (
    <section data-part="install-hint" aria-label={word(labels, "pwa.hint.label", "Add to home screen")} className="mx-3 mb-2 flex items-start gap-3 rounded-2xl border border-line bg-surface p-3 shadow-[var(--v2-shadow-pop)]">
      <OwlSvg still className="size-10" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-semibold">{word(labels, "pwa.hint.title", "Add {brand} to your home screen", { brand: SHORT_NAME })}</p>
        <p className="mt-0.5 text-sm text-muted">
          {how === "prompt" ? word(labels, "pwa.hint.prompt", "Open it like an app, in one tap.") : null}
          {how === "ios" ? (
            <>
              {word(labels, "pwa.hint.ios", "Tap Share, then Add to Home Screen.")} <Share aria-hidden="true" className="inline size-4 align-text-bottom" />
            </>
          ) : null}
          {how === "other" ? word(labels, "pwa.hint.other", "Open your browser menu and choose Add to Home screen.") : null}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {how === "prompt" ? (
            <button type="button" onClick={add} className="min-h-11 rounded-lg border border-brand-edge bg-brand px-4 text-sm font-semibold text-on-brand">
              {word(labels, "pwa.hint.add", "Add")}
            </button>
          ) : null}
          <button type="button" onClick={later} className="min-h-11 rounded-lg border border-line px-4 text-sm font-medium">
            {word(labels, "pwa.hint.later", "Not now")}
          </button>
        </div>
      </div>
      <button type="button" onClick={later} aria-label={word(labels, "pwa.hint.later", "Not now")} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2">
        <X aria-hidden="true" className="size-5" />
      </button>
    </section>
  );
}
