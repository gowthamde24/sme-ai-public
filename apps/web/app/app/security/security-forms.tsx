"use client";

import { useActionState, useState } from "react";

import type { AuthFormState } from "@/lib/auth/form-state";

import { makeT, type Words } from "@/components/v2/app/words";
import { Rich } from "@/components/v2/app/rich";
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
export function EnrolForm({ words }: { words?: Words }) {
  const t = makeT(words);
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
          {busy ? t("acct.starting") : t("acct.set_up_an_authenticator")}
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
      <p className={bodyText}>{t("acct.1_in_your_authenticator_app_google")}</p>
      {setup.qr && (
        // eslint-disable-next-line @next/next/no-img-element -- an SVG data URI from the Auth server; next/image adds nothing
        <img className={qrImage} src={setup.qr} alt={t("acct.qr_code_to_scan_with_your")} width={200} height={200} />
      )}
      <p className={bodyText}>
        <Rich t={t} k="acct.cannot_scan" with={{ key: <code className={codeInline}>{setup.secret}</code> }} />
      </p>
      <label htmlFor="code" className={fieldLabel}>
        {t("acct.2_type_the_six_digits_the")}
      </label>
      <input id="code" className={fieldInput} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required />
      <Err state={state} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("acct.checking") : t("acct.turn_on")}
      </button>
    </form>
  );
}

export function RemoveForm({ words }: { words?: Words }) {
  const t = makeT(words);
  const [state, action, pending] = useActionState<AuthFormState, FormData>(removeAuthenticator, undefined);
  return (
    <form className={formCard} action={action}>
      <label htmlFor="remove-code" className={fieldLabel}>
        {t("acct.to_remove_it_type_a_current")}
      </label>
      <input id="remove-code" className={fieldInput} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required />
      <Err state={state} />
      <button type="submit" className={btnQuiet} disabled={pending}>
        {pending ? t("acct.checking") : t("acct.remove_the_authenticator")}
      </button>
    </form>
  );
}
