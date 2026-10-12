"use client";

import { useEffect } from "react";

import { useLabels } from "./labels-context";
import { ProblemView } from "./ProblemView";
import { RetryButton } from "./RetryButton";

/**
 * The error boundary's screen for everything under /app (job BW; app/app/error.tsx): the owl, "Something went wrong on our side", a Try again button that also tries by itself twice (with a growing wait),
 * and the error's reference (its digest, which matches the server log) for support. The error's message is never shown: on the server it is withheld, and a client error's message is for developers.
 */
export function ErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const labels = useLabels();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ProblemView kind={500} labels={labels} reference={error.digest} action={<RetryButton onRetry={retry} auto />} />;
}
