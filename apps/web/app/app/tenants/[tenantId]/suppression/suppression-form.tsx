"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { BackfillState } from "./actions";

type Action = () => Promise<BackfillState>;

/**
 * The backfill button and what the last press did, in counts. This component never says the contacts are all keyed: that is for the status the page reads again after a press. A person without
 * a second factor gets the reason instead of a button (the API refuses them regardless).
 */
export function BackfillForm({ action, secondFactorMissing }: { action: Action; secondFactorMissing: boolean }) {
  const [state, run, running] = useActionState(action, undefined);
  if (secondFactorMissing)
    return (
      <p role="note">
        Recording keys needs your authenticator app. <Link href="/app/security" className="tap">Set it up on the Security page</Link>, then sign in again with its code.
      </p>
    );
  return (
    <form action={run}>
      <button type="submit" disabled={running}>
        {running ? "Recording keys…" : "Record keys for contacts that have none"}
      </button>
      <p className="hint">Safe to press again: contacts that already have a key are skipped. Each press handles up to 500 contacts.</p>
      {state?.error && (
        <p role="alert" className="error hint">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <div role="status" className="hint">
          <p>
            Recorded keys for {state.recorded} {state.recorded === 1 ? "contact" : "contacts"}. Contacts still without a key: {state.remaining}.
          </p>
          {(state.unkeyable ?? 0) > 0 && (
            <p>
              {state.unkeyable} {state.unkeyable === 1 ? "contact has" : "contacts have"} an e-mail or phone number that cannot be read, so it stays without a key. Fix or remove it, then press again.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
