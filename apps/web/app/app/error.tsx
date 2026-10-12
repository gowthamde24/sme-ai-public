"use client";

import { ErrorScreen } from "@/components/v2/app/robust/ErrorScreen";

/** The 500 screen of everything under /app (job BW): inside the frame, with the owl, a Try again button and the error's reference. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
