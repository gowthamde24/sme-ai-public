"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { BackfillState } from "./actions";
import { alertBox, btnMain, link, mutedText, okBox } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = () => Promise<BackfillState>;

/**
 * The backfill button and what the last press did, in counts. This component never says the contacts are all keyed: that is for the status the page reads again after a press. A person without
 * a second factor gets the reason instead of a button (the API refuses them regardless).
 */
export function BackfillForm({ action, secondFactorMissing, words }: { action: Action; secondFactorMissing: boolean; words?: Words; }) {
  const t = makeT(words);
  const [state, run, running] = useActionState(action, undefined);
  if (secondFactorMissing)
    return (
      <p role="note">
        {t("supp.mfa_recording_keys")} <Link href="/app/security" className={link}>{t("supp.set_it_up_on_the_security")}</Link>{t("supp.mfa_b")}
      </p>
    );
  return (
    <form action={run}>
      <button type="submit" className={btnMain} disabled={running}>
        {running ? t("supp.recording_keys") : t("supp.record_keys_for_contacts_that_have")}
      </button>
      <p className={mutedText}>{t("supp.safe_to_press_again_contacts_that")}</p>
      {state?.error && (
        <p role="alert" className={alertBox}>
          {state.error}
        </p>
      )}
      {state?.ok && (
        <div role="status" className={okBox}>
          <p>
            {state.recorded === 1 ? t("supp.recorded_one", { remaining: state.remaining ?? 0 }) : t("supp.recorded_many", { n: state.recorded ?? 0, remaining: state.remaining ?? 0 })}
          </p>
          {(state.unkeyable ?? 0) > 0 && (
            <p>
              {state.unkeyable === 1 ? t("supp.unkeyable_one") : t("supp.unkeyable_many", { n: state.unkeyable ?? 0 })}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
