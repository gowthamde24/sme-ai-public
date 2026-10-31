"use client";

import { ProblemView } from "@/components/v2/app/robust/ProblemView";
import { V2Root } from "@/components/v2/V2Root";

/** The body of the root error page (app/global-error.tsx): the owl, the plain sentence and a reload. Its own file so that the page's first load does not carry it (the route-JS budget counts what every page loads): it is fetched only when this error happens. */
export function GlobalErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <V2Root className="min-h-dvh bg-bg text-ink">
            <ProblemView
              kind={500}
              reference={error.digest}
              action={
                <button type="button" onClick={() => retry()} className="inline-flex min-h-12 items-center justify-center rounded-full border border-brand-edge bg-brand px-6 text-base font-bold text-on-brand hover:brightness-95">
                  Try again
                </button>
              }
            />
          </V2Root>
  );
}
