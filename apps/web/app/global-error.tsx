"use client";

import { ProblemView } from "@/components/v2/app/robust/ProblemView";
import { V2Root } from "@/components/v2/V2Root";

/**
 * The last resort (job BW): an error in the root layout itself, where nothing else is drawn. It must bring its own <html> and <body>. It cannot read the person's language (no cookies here), so it speaks English, with the
 * owl and a plain reload; the stylesheet comes with V2Root.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
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
      </body>
    </html>
  );
}
