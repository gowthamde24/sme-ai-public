"use client";

import { useState } from "react";
import { alertBox, btnQuiet, okBox, quoteTextBox } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

/**
 * A draft's text, as plain text, with a button that copies it. This application sends nothing: the person pastes it into their own message. The text is shown as text (never as markup).
 */
export function DraftText({ text, words }: { text: string; words?: Words; }) {
  const t = makeT(words);
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
      <pre className={quoteTextBox} tabIndex={0} aria-label={t("fu.draft_text")}>
        {text}
      </pre>
      <button type="button" className={btnQuiet} onClick={copy}>
        {t("fu.copy_the_text")}
      </button>
      {copied === "done" ? (
        <p role="status" className={okBox}>
          {t("fu.copied_paste_it_into_your_own")}
        </p>
      ) : null}
      {copied === "failed" ? (
        <p role="alert" className={alertBox}>
          {t("fu.could_not_copy_select_the_text")}
        </p>
      ) : null}
    </div>
  );
}
