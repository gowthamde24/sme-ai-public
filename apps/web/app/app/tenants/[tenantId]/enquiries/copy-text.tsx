"use client";

import { useState } from "react";

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
      <p role="note" className="notice">
        <strong>Nothing is sent by the system.</strong> Copy this text and send it yourself, in your own message.
      </p>
      <pre className="quote-text" tabIndex={0} aria-label="Quote text for the customer">
        {text}
      </pre>
      <button type="button" onClick={copy}>
        Copy text
      </button>
      {copied === "done" ? (
        <p role="status" className="hint">
          Copied. Paste it into your own message.
        </p>
      ) : null}
      {copied === "failed" ? (
        <p role="alert" className="error hint">
          Could not copy. Select the text above and copy it yourself.
        </p>
      ) : null}
    </div>
  );
}
