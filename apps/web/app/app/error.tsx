"use client";

import * as React from "react";

import { word } from "@/components/v2/app/labels";
import { useLabels } from "@/components/v2/app/robust/labels-context";
import type { ErrorScreen as Drawn } from "@/components/v2/app/robust/ErrorScreen";

/**
 * The 500 screen of everything under /app (job BW): inside the frame, with the owl, a Try again button and the error's reference. The screen is a chunk of its own, fetched when an error happens (every page would otherwise carry it);
 * until it arrives a plain sentence and a Try again stand in.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const labels = useLabels();
  const [Screen, setScreen] = React.useState<typeof Drawn | null>(null);
  React.useEffect(() => void import("@/components/v2/app/robust/ErrorScreen").then((m) => setScreen(() => m.ErrorScreen), () => undefined), []);
  if (Screen) return <Screen error={error} retry={retry} />;
  return (
    <main role="alert" className="mx-auto max-w-md p-6 text-center">
      <p>{word(labels, "problem.500.title", "Something went wrong on our side")}</p>
      <button type="button" onClick={() => retry()} className="mt-3 min-h-11 rounded-full border border-edge px-5 font-semibold">
        {word(labels, "problem.retry", "Try again")}
      </button>
    </main>
  );
}
