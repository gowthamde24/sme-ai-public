import * as React from "react";

import { fieldHelp, fieldLabel } from "../ui";
import type { Say } from "../words";

/**
 * One mandatory field of the verification forms (owner, 26 Nov 2026): the label with a plain "Required" beside it, the control (the caller gives it `required`, `aria-required`, `aria-invalid` and `aria-describedby={describedBy}`), an optional hint,
 * and, once the field was touched or the form was sent, ONE plain sentence under it behind a neutral dot (no red wall). `error` is the sentence or null.
 */
export function RequiredField({ t, id, label, hint, error, children }: { t: Say; id: string; label: string; hint?: string; error: string | null; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col" data-field={id}>
      <div className="flex items-baseline gap-2">
        <label htmlFor={id} className={fieldLabel}>
          {label}
        </label>
        <span aria-hidden="true" className="text-sm text-muted" data-part="required">
          {t("pick.kyc.req")}
        </span>
      </div>
      {children}
      {hint ? <p className={`${fieldHelp} m-0`}>{hint}</p> : null}
      {error ? <FieldError id={`${id}-err`} text={error} /> : null}
    </div>
  );
}
export const describedBy = (id: string, error: string | null): string | undefined => (error ? `${id}-err` : undefined);

export function FieldError({ id, text }: { id: string; text: string }) {
  return (
    <p id={id} data-part="field-error" className="m-0 mt-1.5 flex items-start gap-2 text-sm text-ink">
      <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-text" />
      <span>{text}</span>
    </p>
  );
}
