import type { EnquiryActionState } from "./actions";

/** The outcome of a form: our own short sentence (never text from the API or the customer). */
export function ActionResult({ state }: { state: EnquiryActionState }) {
  if (state?.error)
    return (
      <p role="alert" className="error hint">
        {state.error}
      </p>
    );
  if (state?.ok && state.message)
    return (
      <p role="status" className="hint">
        {state.message}
      </p>
    );
  return null;
}
