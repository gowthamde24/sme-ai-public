"use client";

import { useActionState, useState } from "react";

import type { AuthFormState } from "@/lib/auth/form-state";

import {
  type EnrolState,
  finishEnrolment,
  removeAuthenticator,
  startEnrolment,
} from "./actions";

function Err({ state }: { state: AuthFormState }) {
  return state?.error ? (
    <p role="alert" className="error">
      {state.error}
    </p>
  ) : null;
}

/** Set up: press the button, scan the QR code (or type the secret), then type a code to prove it works. */
export function EnrolForm() {
  const [setup, setSetup] = useState<EnrolState>(undefined);
  const [busy, setBusy] = useState(false);
  const [state, action, pending] = useActionState<AuthFormState, FormData>(finishEnrolment, undefined);

  if (!setup?.factorId) {
    return (
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setSetup(await startEnrolment());
            setBusy(false);
          }}
        >
          {busy ? "Starting..." : "Set up an authenticator"}
        </button>
        {setup?.error && (
          <p role="alert" className="error">
            {setup.error}
          </p>
        )}
      </div>
    );
  }
  return (
    <form className="card" action={action}>
      <input type="hidden" name="factor_id" value={setup.factorId} />
      <p>1. In your authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, 1Password...), add an account by scanning this code.</p>
      {setup.qr && (
        // eslint-disable-next-line @next/next/no-img-element -- an SVG data URI from the Auth server; next/image adds nothing
        <img src={setup.qr} alt="QR code to scan with your authenticator app" width={200} height={200} />
      )}
      <p>
        Cannot scan it? Type this key into the app instead: <code>{setup.secret}</code>
      </p>
      <label htmlFor="code">2. Type the six digits the app shows</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required />
      <Err state={state} />
      <button type="submit" disabled={pending}>
        {pending ? "Checking..." : "Turn on"}
      </button>
    </form>
  );
}

export function RemoveForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(removeAuthenticator, undefined);
  return (
    <form className="card" action={action}>
      <label htmlFor="remove-code">To remove it, type a current code from the app</label>
      <input id="remove-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required />
      <Err state={state} />
      <button type="submit" className="secondary" disabled={pending}>
        {pending ? "Checking..." : "Remove the authenticator"}
      </button>
    </form>
  );
}
