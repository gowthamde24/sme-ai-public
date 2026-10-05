"use client";

import { useActionState } from "react";

import type { AuthFormState } from "@/lib/auth/form-state";

import { confirmLink } from "./actions";

export function ConfirmForm({
  tokenHash,
  type,
  next,
}: {
  tokenHash: string;
  type: string;
  next: string;
}) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    confirmLink,
    undefined,
  );
  return (
    <form className="card" action={action}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        Continue
      </button>
    </form>
  );
}
