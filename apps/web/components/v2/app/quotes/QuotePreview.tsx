import { Fragment, type ReactNode } from "react";

import { makeT, type Words } from "../words";

/** WhatsApp's own marks, and only those: *bold* and _italic_ on one line. Everything stays a text node (escaped): the customer's words and ours are never markup. */
function marked(line: string): ReactNode[] {
  return line.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, i) =>
    part.length > 2 && part.startsWith("*") && part.endsWith("*") ? <strong key={i}>{part.slice(1, -1)}</strong> : part.length > 2 && part.startsWith("_") && part.endsWith("_") ? <em key={i}>{part.slice(1, -1)}</em> : <Fragment key={i}>{part}</Fragment>,
  );
}

/**
 * The quote as the customer sees it on WhatsApp (app v4 part 6, owner 7 Nov 2026): the approved quote's own text (from the engine; never re-worded) in a message bubble, with Send and Change it. "Send" is the existing "Open in WhatsApp"
 * link (this site's own redirect, drawn only where the gate is open and the text fits): the person presses send in their own WhatsApp, this app sends nothing. "Change it" goes to making a new draft, which replaces this quote.
 * Server markup; the text is plain text with WhatsApp's bold and italic marks.
 */
export function QuotePreview({ text, sendHref, changeHref, words }: { text: string; sendHref: string | null; changeHref: string | null; words?: Words }) {
  const t = makeT(words);
  const lines = text.split("\n");
  return (
    <section aria-labelledby="qp-v4-title" className="flex flex-col gap-3 rounded-[22px] border border-line bg-surface p-4" data-part="quote-preview">
      <h3 id="qp-v4-title" className="m-0 font-display text-lg font-bold">
        {t("qp.v4.title")}
      </h3>
      <div className="rounded-2xl bg-[#efeae2] p-3 dark:bg-[#0b141a]" data-part="quote-bubble-area">
        <div className="ml-auto max-w-[min(100%,26rem)] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[15px] leading-snug text-[#111b21] shadow-[0_1px_1px_rgba(11,20,26,.18)] dark:bg-[#005c4b] dark:text-[#e9edef]" data-part="quote-bubble" lang="und">
          {lines.map((l, i) => (
            <p key={i} className="m-0 min-h-[1.2em] whitespace-pre-wrap [overflow-wrap:anywhere]">
              {marked(l)}
            </p>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {sendHref ? (
          // a plain anchor, not a Link: nothing prefetches it, and the number is read on the server by the redirect
          <a href={sendHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full bg-[#ff773c] px-6 font-extrabold text-[#1e1e24]" data-part="quote-send">
            {t("qp.v4.send")}
          </a>
        ) : null}
        {changeHref ? (
          <a href={changeHref} className="inline-flex min-h-11 items-center rounded-full border-2 border-edge bg-surface px-5 font-bold text-ink" data-part="quote-change">
            {t("qp.v4.change")}
          </a>
        ) : null}
      </div>
      <p className="m-0 text-xs text-muted">{t("qp.v4.note")}</p>
    </section>
  );
}
