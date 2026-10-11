"use client";

import * as React from "react";

import type { Lang } from "@/i18n/lang";

import type { Uploader } from "../catalogue/catalogue-types";
import type { preparePhoto } from "../catalogue/prepare-photo";
import { say, type TodayWords } from "../today/today-words";
import { SetupChecklist } from "./SetupChecklist";
import { SetupWizard } from "./SetupWizard";
import { firstOpenStep, isFresh, itemsOf, STEPS, viewOf, type Local } from "./setup-logic";
import { readLocal, subscribeLocal, writeLocal } from "./setup-store";
import type { SetupActions, SetupFacts } from "./types";

/**
 * What the Owner sees on Today (job BJ): the setup wizard instead of an empty Today for a brand-new workspace, the checklist card above Today while items are left, or Today as it is. The facts come from the
 * API (the server read them); what this device has done or hidden is its own memory (setup-store.ts). Until that memory is read, a brand-new workspace shows a short "getting things ready" and anything else
 * shows Today at once, so nothing flashes.
 */
export function SetupGate({ tenantId, base, lang, facts, words, actions, children, uploader, prepare }: { tenantId: string; base: string; lang: Lang; facts: SetupFacts; words: TodayWords; actions: SetupActions; children: React.ReactNode; uploader?: Uploader; prepare?: typeof preparePhoto }) {
  const local = React.useSyncExternalStore(
    subscribeLocal,
    () => readLocal(tenantId),
    () => null,
  );
  const [reopened, setReopened] = React.useState<number | null>(null); // "Continue setup" from the checklist opens the wizard at this step
  const patch = React.useCallback((p: Partial<Local>) => void writeLocal(tenantId, p), [tenantId]);

  if (local === null) {
    return isFresh(facts) ? (
      <div role="status" aria-live="polite" data-setup="loading" className="flex min-h-[40dvh] items-center justify-center text-base text-muted">
        {say(words, "setup.loading")}
      </div>
    ) : (
      <>{children}</>
    );
  }

  const items = itemsOf(facts, local);
  const view = reopened !== null ? "wizard" : viewOf(facts, local);

  if (view === "wizard") {
    const step = reopened ?? local.step;
    return (
      <SetupWizard
        base={base}
        lang={lang}
        facts={facts}
        local={local}
        words={words}
        actions={actions}
        step={step}
        goTo={(next, p) => {
          const clamped = Math.min(Math.max(next, 0), STEPS.length - 1);
          if (reopened !== null) setReopened(clamped);
          patch({ step: clamped, ...(p ?? {}) });
        }}
        onSkip={() => {
          setReopened(null);
          patch({ state: "skipped" });
        }}
        onFinish={() => {
          setReopened(null);
          patch({ state: "done", step: 0 });
        }}
        uploader={uploader}
        prepare={prepare}
      />
    );
  }
  return (
    <>
      {view === "checklist" ? (
        <SetupChecklist
          words={words}
          items={items}
          onContinue={() => setReopened(firstOpenStep(items))}
          onOpen={(step) => setReopened(step)}
          onHide={() => patch({ state: "dismissed" })}
        />
      ) : null}
      {children}
    </>
  );
}
