"use client";

import { LogIn, WifiOff } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { retryWithBackoff } from "@/lib/net/backoff";

import { word, type Labels } from "../labels";
import { CLICK_LOCK_MS, SUBMIT_LOCK_MS, formKey, guardedButton, screenKey, startsNavigation, tooSoon } from "./guards";
import { useOnline } from "./use-online";

type Session = "ok" | "ended" | "back";

/** A move to another page that has not arrived after this long says it is taking longer; one that has not arrived after this much more is no longer waited for. */
const SLOW_NAV_MS = 8000;
const GIVE_UP_NAV_MS = 25_000;

/** A page that has been open a while asks again when it comes back to the front, and every few minutes while it is in front. */
const CHECK_EVERY_MS = 4 * 60_000;
const STALE_MS = 10_000;

/**
 * What keeps a page working when the world does not (job BW), drawn once under the top bar and listening on the whole document:
 *  - OFFLINE: a banner says so; when the connection returns the page re-reads its data once. A form submitted while offline is NOT sent and says so; what was typed stays.
 *  - SESSION: the page asks `/app/session` when it returns to the front and every few minutes. If the session has ended a banner offers "Sign in again" in a NEW tab (it comes back to this very page); this page
 *    and everything typed in it stay. A form submitted with an ended session is not sent either and says so. When the person is signed in again the banner says so and goes.
 *  - DOUBLE PRESS: a second submit of a form, or a second click of a button, inside a short window is ignored (guards.ts). `data-repeat` (a button meant to be pressed again), `data-no-guard` (any element
 *    or form inside it) opt out.
 * It reads nothing about the person and stores nothing.
 */
export function RobustShell({ labels }: { labels?: Labels }) {
  const online = useOnline();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [session, setSession] = useState<Session>("ok");
  const [back, setBack] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [moving, setMoving] = useState<"no" | "yes" | "slow">("no");
  const [placeKey, setPlaceKey] = useState(`${pathname}?${search}`);
  const sessionRef = useRef<Session>("ok");
  const onlineRef = useRef(online);
  const lastCheck = useRef(0);
  const wasOffline = useRef(false);
  const labelsRef = useRef(labels);
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
    sessionRef.current = session;
    onlineRef.current = online;
    labelsRef.current = labels;
  });

  // a new page has arrived: the "Loading" mark goes (set while drawing, not in an effect)
  if (placeKey !== `${pathname}?${search}`) {
    setPlaceKey(`${pathname}?${search}`);
    setMoving("no");
  }
  // a move that takes long says so, and one that never arrives stops being waited for
  useEffect(() => {
    if (moving === "no") return;
    const t = setTimeout(() => setMoving(moving === "yes" ? "slow" : "no"), moving === "yes" ? SLOW_NAV_MS : GIVE_UP_NAV_MS - SLOW_NAV_MS);
    return () => clearTimeout(t);
  }, [moving]);

  // the connection comes back: one fresh read of the page's data, and a short "back online"
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setBack(true);
    routerRef.current.refresh();
    const t = setTimeout(() => setBack(false), 4000);
    return () => clearTimeout(t);
  }, [online]);

  const check = useCallback(async () => {
    if (!navigator.onLine) return;
    lastCheck.current = Date.now();
    try {
      const res = await retryWithBackoff(() => fetch("/app/session", { cache: "no-store", redirect: "manual", headers: { Accept: "application/json" } }), { tries: 2, base: 800 });
      // a redirect (to sign in, or to the authenticator) or a 401 = the session is no longer good; a 503 or anything else = we do not know, so we say nothing
      if (res.type === "opaqueredirect" || res.status === 401) setSession("ended");
      else if (res.ok) setSession((s) => (s === "ended" ? "back" : s));
    } catch {
      // no answer: not a sign-out
    }
  }, []);

  useEffect(() => {
    const soon = () => {
      if (document.visibilityState === "visible" && (sessionRef.current === "ended" || Date.now() - lastCheck.current > STALE_MS)) void check();
    };
    const timer = setInterval(() => document.visibilityState === "visible" && void check(), CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", soon);
    window.addEventListener("focus", soon);
    window.addEventListener("online", soon);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", soon);
      window.removeEventListener("focus", soon);
      window.removeEventListener("online", soon);
    };
  }, [check]);

  // "signed in again" is shown for a moment, then the banner goes
  useEffect(() => {
    if (session !== "back") return;
    const t = setTimeout(() => setSession("ok"), 4000);
    return () => clearTimeout(t);
  }, [session]);

  // a "not sent" notice does not stay for ever
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(t);
  }, [notice]);

  // the guards on the whole document (capture phase: before the page's own handlers see the event)
  useEffect(() => {
    const locked = new WeakMap<HTMLFormElement, { at: number; key: string }>();
    const clicks = new WeakMap<HTMLButtonElement, { at: number; screen: string }>();
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onSubmit = (e: Event) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || form.closest("[data-no-guard]")) return;
      if (!onlineRef.current || !navigator.onLine) {
        stop(e);
        setNotice(word(labelsRef.current, "robust.offline.blocked", "Not sent. You are offline. Press the button again when you are back online."));
        return;
      }
      if (sessionRef.current === "ended") {
        stop(e);
        setNotice(word(labelsRef.current, "robust.session.blocked", "Not sent. Your session has ended. Sign in again, then press the button again."));
        return;
      }
      // the same form with the SAME contents inside the window is one press arriving twice; a changed value (a new search, a correction) is a new submit
      const key = formKey(form);
      const last = locked.get(form);
      if (last && last.key === key && tooSoon(last.at, e.timeStamp, SUBMIT_LOCK_MS)) {
        stop(e);
        return;
      }
      locked.set(form, { at: e.timeStamp, key });
      setNotice(null);
      const submitter = (e as SubmitEvent).submitter;
      form.setAttribute("aria-busy", "true");
      submitter?.setAttribute("aria-disabled", "true");
      setTimeout(() => {
        form.removeAttribute("aria-busy");
        submitter?.removeAttribute("aria-disabled");
      }, SUBMIT_LOCK_MS);
    };
    const onClick = (e: Event) => {
      const button = guardedButton(e.target);
      if (!button) return;
      // the same button on the same screen: a screen that has moved on (a wizard's next step) is a new press
      const screen = screenKey();
      const last = clicks.get(button);
      if (last && last.screen === screen && tooSoon(last.at, e.timeStamp, CLICK_LOCK_MS)) {
        stop(e);
        return;
      }
      clicks.set(button, { at: e.timeStamp, screen });
    };
    const onLink = (e: MouseEvent) => {
      const anchor = e.target instanceof Element ? e.target.closest("a") : null;
      if (startsNavigation(anchor, e, window.location)) setMoving("yes");
    };
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("click", onLink);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("click", onLink);
    };
  }, []);

  const here = `${pathname}${search ? `?${search}` : ""}`;
  const box = "mx-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-text bg-amber-bg px-4 py-3 text-base text-amber-text md:mx-8";
  const ok = "mx-4 mt-3 rounded-xl border border-green-text bg-green-bg px-4 py-3 text-base font-medium text-green-text md:mx-8";
  return (
    <div data-robust="shell" data-no-guard="" className="sticky top-16 z-20">
      <div>
        {!online ? (
          <div role="status" className={box} data-robust="offline">
            <WifiOff className="size-5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1">
              <strong>{word(labels, "robust.offline.title", "You are offline")}.</strong> {word(labels, "robust.offline.body", "What you see may be old. Buttons that need the internet wait until you are back.")}
            </p>
          </div>
        ) : back ? (
          <p role="status" className={ok} data-robust="online">
            {word(labels, "robust.online.back", "You are back online.")}
          </p>
        ) : null}
        {session === "ended" ? (
          <div role="status" className={box} data-robust="session">
            <LogIn className="size-5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1">
              <strong>{word(labels, "robust.session.ended", "Your session has ended")}.</strong> {word(labels, "robust.session.body", "Sign in again in a new tab. What you typed here stays on this page.")}
            </p>
            <a
              href={`/login?next=${encodeURIComponent(here)}`}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-11 items-center rounded-full border border-brand-edge bg-brand px-5 text-base font-bold text-on-brand hover:brightness-95"
            >
              {word(labels, "robust.session.signin", "Sign in again")}
            </a>
          </div>
        ) : session === "back" ? (
          <p role="status" className={ok} data-robust="signed-in">
            {word(labels, "robust.session.back", "You are signed in again. You can go on.")}
          </p>
        ) : null}
      </div>
      {moving !== "no" ? (
        <>
          <div aria-hidden="true" data-robust="progress" className="fixed inset-x-0 top-0 z-[80] h-1 bg-brand motion-safe:animate-pulse" />
          <p role="status" className="sr-only">
            {moving === "slow" ? word(labels, "robust.slow", "This is taking longer than usual. Still trying.") : word(labels, "robust.loading", "Loading…")}
          </p>
          {moving === "slow" ? (
            <p aria-hidden="true" className="mx-4 mt-3 text-base text-muted md:mx-8">
              {word(labels, "robust.slow", "This is taking longer than usual. Still trying.")}
            </p>
          ) : null}
        </>
      ) : null}
      {notice ? (
        <p role="alert" data-robust="blocked" className={box}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}
