import { Suspense, use } from "react";

import { ActivationCard } from "@/components/v2/app/start/ActivationCard";
import type { AppT } from "@/i18n/app";
import type { Activation } from "@/lib/packs/activation";

/**
 * "Finish setting up" streams in AFTER the first paint: it sits under the cards and its facts are the slowest read of a cold Today (staging, 12 Nov 2026: `setup_progress` 2.7 s cold), so the page no longer waits for them. `asked` is the promise the page
 * started with its other reads (one that fails is no card, never a broken page; the other reads raise a rejected session). Nothing is drawn while it waits and nothing when every step is done.
 */
function Intro({ asked, base, t, hide }: { asked: Promise<Activation | null>; base: string; t: AppT; hide: (formData: FormData) => Promise<void> }) {
  const activation = use(asked);
  if (!activation || activation.done >= activation.total) return null;
  return (
    <div data-part="start">
      <ActivationCard collapse activation={activation} base={base} t={t} hide={hide} />
    </div>
  );
}

export function ActivationIntro(props: { asked: Promise<Activation | null>; base: string; t: AppT; hide: (formData: FormData) => Promise<void> }) {
  return (
    <Suspense fallback={null}>
      <Intro {...props} />
    </Suspense>
  );
}
