"use client";

import * as React from "react";

import type { GlobalErrorScreen as Drawn } from "@/components/v2/app/robust/GlobalErrorScreen";

/**
 * The last resort (job BW): an error in the root layout itself, where nothing else is drawn. It must bring its own <html> and <body>. It cannot read the person's language (no cookies here), so it speaks English: the owl and a plain reload; the stylesheet comes with V2Root.
 * The screen itself is a chunk of its own, fetched when this error happens (every page would otherwise carry it); until it arrives (or if it cannot be fetched) a plain sentence and a reload stand in.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [Screen, setScreen] = React.useState<typeof Drawn | null>(null);
  React.useEffect(() => void import("@/components/v2/app/robust/GlobalErrorScreen").then((m) => setScreen(() => m.GlobalErrorScreen), () => undefined), []);
  return (
    <html lang="en">
      <body>
        {Screen ? (
          <Screen error={error} retry={retry} />
        ) : (
          <main role="alert" style={{ padding: "2rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
            <h1>Something went wrong on our side</h1>
            <p>It is not you. Please try again in a moment.</p>
            <button type="button" onClick={() => retry()}>
              Try again
            </button>
          </main>
        )}
      </body>
    </html>
  );
}
