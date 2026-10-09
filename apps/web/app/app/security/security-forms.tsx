"use client";

import { useActionState, useState } from "react";

import type { AuthFormState } from "@/lib/auth/form-state";

import { alertBox, bodyText, btnMain, btnQuiet, codeInline, fieldInput, fieldLabel, formCard, qrImage } from "@/components/v2/app/ui";

import {
  type EnrolState,
  finishEnrolment,
  removeAuthenticator,
  startEnrolment,
} from "./actions";

function Err({ state }: { state: AuthFormState }) {
  return state?.error ? (
    <p role="alert" className={alertBox}>
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
          className={btnMain}
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
          <p role="alert" className={alertBox}>
            {setup.error}
          </p>
        )}
      </div>
    );
  }
  return (
    <form className={formCard} action={action}>
      <input type="hidden" name="factor_id" value={setup.factorId} />
      <p className={bodyText}>1. In your authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, 1Password...), add an account by scanning this code.</p>
      {setup.qr && (
        // eslint-disable-next-line @next/next/no-img-element -- an SVG data URI from the Auth server; next/image adds nothing
        <img className={qrImage} src={setup.qr} alt="QR code to scan with your authenticator app" width={200} height={200} />
      )}
      <p className={bodyText}>
        Cannot scan it? Type this key into the app instead: <code className={codeInline}>{setup.secret}</code>
      </p>
      <label htmlFor="code" className={fieldLabel}>
        2. Type the six digits the app shows
      </label>
      <input id="code" className={fieldInput} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required />
      <Err state={state} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Checking..." : "Turn on"}
      </button>
    </form>
  );
}

export function RemoveForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(removeAuthenticator, undefined);
  return (
    <form className={formCard} action={action}>
      <label htmlFor="remove-code" className={fieldLabel}>
        To remove it, type a current code from the app
      </label>
      <input id="remove-code" className={fieldInput} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required />
      <Err state={state} />
      <button type="submit" className={btnQuiet} disabled={pending}>
        {pending ? "Checking..." : "Remove the authenticator"}
      </button>
    </form>
  );
}
