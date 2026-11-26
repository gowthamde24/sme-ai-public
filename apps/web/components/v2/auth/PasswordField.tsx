"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";

/**
 * A password input with a "show password" eye (owner, 26 Nov 2026), ONE component for every account password (sign-in, sign-up, new password). The input stays an ordinary input whose `type` flips between password and text, so the browser's and the password manager's autofill and save keep working;
 * the eye is a real button inside the field on the right, 48 px square (the field is 48 px high: a 44 px touch target at least), named "Show password" / "Hide password" in the person's language with `aria-pressed`, reachable by Tab, and it never submits the form.
 * The password goes back to hidden when focus leaves the field and its eye, and the shown text is not auto-capitalised or spell-checked.
 */
export function PasswordField({ showLabel = "Show password", hideLabel = "Hide password", className = "", ...input }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { showLabel?: string; hideLabel?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div
      data-part="password-field"
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShown(false);
      }}
    >
      <input {...input} type={shown ? "text" : "password"} autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${className} pr-12`} />
      <button
        type="button"
        aria-label={shown ? hideLabel : showLabel}
        aria-pressed={shown}
        onClick={() => setShown((v) => !v)}
        className="absolute right-0 top-0 grid size-12 place-items-center rounded-lg text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-edge"
      >
        {shown ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
      </button>
    </div>
  );
}
