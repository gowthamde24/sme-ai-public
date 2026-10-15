"use client";

import * as React from "react";

import { secondary } from "../visits/styles";

/** "Copy as a message": puts a short text on the clipboard for the person to paste into WhatsApp themselves. The system sends nothing. Left out of the printed page. */
export function CopyButton({ label, copiedLabel, text }: { label: string; copiedLabel: string; text: string }) {
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-3 print:hidden">
      <button type="button" className={secondary} onClick={() => void copy()}>{label}</button>
      {copied ? <span role="status" className="text-sm font-semibold text-green-text">{copiedLabel}</span> : null}
    </span>
  );
}
