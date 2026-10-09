"use client";

import { useState } from "react";
import { alertBox, btnQuiet, okBox, quoteTextBox } from "@/components/v2/app/ui";

/**
 * A draft's text, as plain text, with a button that copies it. This application sends nothing: the person pastes it into their own message. The text is shown as text (never as markup).
 */
export function DraftText({ text }: { text: string }) {
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
      <pre className={quoteTextBox} tabIndex={0} aria-label="Draft text">
        {text}
      </pre>
      <button type="button" className={btnQuiet} onClick={copy}>
        Copy the text
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
