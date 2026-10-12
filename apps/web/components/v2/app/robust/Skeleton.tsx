"use client";

import { useEffect, useState } from "react";

import { word, type Labels } from "../labels";
import { pageMain } from "../ui";
import { useLabels } from "./labels-context";

/** After this long a skeleton adds a sentence: slow is not the same as stuck. */
export const SLOW_AFTER_MS = 8000;

const bar = "rounded-lg bg-surface-2 motion-safe:animate-pulse";

/**
 * What a page shows while its data is on the way (job BW; app/app/loading.tsx): the shape of a page (a title, a line, three cards) in the page's own colours, so the frame never jumps. It is announced once
 * ("Loading…"), pulses only for people who have not asked for reduced motion, and after eight seconds says that it is taking longer than usual and that it is still trying.
 */
export function PageSkeleton({ labels: given }: { labels?: Labels }) {
  const inFrame = useLabels();
  const labels = given ?? inFrame;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <main className={pageMain} aria-busy="true" data-skeleton="">
      <p role="status" className="sr-only">
        {slow ? word(labels, "robust.slow", "This is taking longer than usual. Still trying.") : word(labels, "robust.loading", "Loading…")}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className={`${bar} h-10 w-2/3 max-w-sm`} />
        <div className={`${bar} h-5 w-full max-w-xl`} />
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
              <div className={`${bar} h-6 w-1/2`} />
              <div className={`${bar} h-4 w-full`} />
              <div className={`${bar} h-4 w-5/6`} />
              <div className={`${bar} h-10 w-1/3`} />
            </div>
          ))}
        </div>
      </div>
      {slow ? (
        <p aria-hidden="true" className="mt-6 text-base text-muted">
          {word(labels, "robust.slow", "This is taking longer than usual. Still trying.")}
        </p>
      ) : null}
    </main>
  );
}
