"use client";

import { Check, Copy, Mail } from "lucide-react";
import { useState } from "react";

export type EmailAddressWords = { copy: string; copied: string; copyAria: string; failed: string; mail: string; mailAria: string };

/**
 * One public e-mail address (job DB): the address itself as plain, selectable text, a Copy button, and a mailto: link as an extra for people whose device has a mail app. The words come from the server as props (this file holds no
 * dictionary). The address is never built from user input; it comes from lib/site/business.ts.
 */
export function EmailAddress({ address, words }: { address: string; words: EmailAddressWords }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
    }
  }
  const say = (w: string) => w.replace("{address}", address);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span data-part="address" className="select-all break-all text-base font-semibold text-ink">
        {address}
      </span>
      <button type="button" onClick={copy} aria-label={say(words.copyAria)} className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg border border-edge bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2">
        {state === "copied" ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        {state === "copied" ? words.copied : words.copy}
      </button>
      <a href={`mailto:${address}`} aria-label={say(words.mailAria)} className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand-text hover:underline">
        <Mail className="size-4" aria-hidden="true" />
        {words.mail}
      </a>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? words.copied : state === "failed" ? words.failed : ""}
      </span>
      {state === "failed" ? <span className="w-full text-sm text-muted">{words.failed}</span> : null}
    </div>
  );
}
