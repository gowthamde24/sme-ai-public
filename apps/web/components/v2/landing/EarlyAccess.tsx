"use client";

import { Clock } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useMedia } from "@/components/v2/landing/hooks";
import { container, h2, lead } from "@/components/v2/landing/ui";

export interface EarlyAccessLabels {
  title: string;
  body: string;
  status: string;
  nodata: string;
  clicked: string;
}

const subscribeHash = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};

/**
 * The early-access box. It is a PLACEHOLDER: no form, no field, no request, nothing saved. Following the "Request early
 * access" link (the URL hash is #early-access) shows a thank-you line and moves focus here; that is all it does.
 */
export function EarlyAccess({ labels }: { labels: EarlyAccessLabels }) {
  const requested = useSyncExternalStore(subscribeHash, () => window.location.hash === "#early-access", () => false);
  const ref = useRef<HTMLHeadingElement>(null);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  useEffect(() => {
    if (!requested) return;
    ref.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    ref.current?.focus({ preventScroll: true });
  }, [requested, reduced]);
  return (
    <section id="early-access" aria-labelledby="early-h" className="scroll-mt-20 border-y border-line bg-brand-bg/50 py-14 sm:py-20">
      <div className={`${container} max-w-3xl`}>
        <h2 id="early-h" ref={ref} tabIndex={-1} className={`${h2} outline-none`}>{labels.title}</h2>
        <p className={lead}>{labels.body}</p>
        <div className="mt-6 rounded-xl border border-edge bg-surface p-5">
          <p className="inline-flex items-center gap-2 rounded-md bg-amber-bg px-2 py-1 text-base font-semibold text-amber-text">
            <Clock className="size-4" aria-hidden="true" />
            {labels.status}
          </p>
          <p className="mt-3 text-muted">{labels.nodata}</p>
          <p role="status" className="mt-3 min-h-6 font-medium text-green-text">{requested ? labels.clicked : ""}</p>
        </div>
      </div>
    </section>
  );
}
