"use client";

import { useState } from "react";

import { alertBox, btnQuiet, noteBox, okBox, quoteTextBox } from "@/components/v2/app/ui";

/**
 * The text of an APPROVED quote, as plain text, with a button that copies it. This application sends nothing: the person pastes it into their own
 * message. The text is shown as text (never as markup).
 */
export function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }
  return (
    <div>
      <p role="note" className={noteBox}>
        <strong>Nothing is sent by the system.</strong> Copy this text and send it yourself, in your own message.
      </p>
      <pre className={quoteTextBox} tabIndex={0} aria-label="Quote text for the customer">
        {text}
      </pre>
      <button type="button" onClick={copy} className={`${btnQuiet} mt-3`}>
        Copy text
      </button>
      {copied === "done" ? (
        <p role="status" className={okBox}>
          Copied. Paste it into your own message.
        </p>
      ) : null}
      {copied === "failed" ? (
        <p role="alert" className={alertBox}>
          Could not copy. Select the text above and copy it yourself.
        </p>
      ) : null}
    </div>
  );
}
