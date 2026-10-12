"use client";

import { useState } from "react";

import { alertBox, btnQuiet, noteBox, okBox, quoteTextBox } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

/**
 * The text of an APPROVED quote, as plain text, with a button that copies it. This application sends nothing: the person pastes it into their own
 * message. The text is shown as text (never as markup).
 */
export function CopyText({ text, words }: { text: string; words?: Words; }) {
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
      <p role="note" className={noteBox}>
        <strong>{t("enq.nothing_is_sent_by_the_system")}</strong> {t("enq.copy_it_yourself")}
      </p>
      <pre className={quoteTextBox} tabIndex={0} aria-label={t("enq.quote_text_for_the_customer")}>
        {text}
      </pre>
      <button type="button" onClick={copy} className={`${btnQuiet} mt-3`}>
        {t("enq.copy_text")}
      </button>
      {copied === "done" ? (
        <p role="status" className={okBox}>
          {t("enq.copied_paste_it_into_your_own")}
        </p>
      ) : null}
      {copied === "failed" ? (
        <p role="alert" className={alertBox}>
          {t("enq.could_not_copy_select_the_text")}
        </p>
      ) : null}
    </div>
  );
}
