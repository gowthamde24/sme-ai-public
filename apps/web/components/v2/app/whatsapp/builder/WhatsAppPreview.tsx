import { fillName, type DraftLang, type Message } from "@/lib/templates/meta-checks";

import type { Say } from "../../words";

/**
 * THE LIVE WHATSAPP PREVIEW: what the customer sees, in WhatsApp's own colours (light and dark): the business name on top, one bubble (title in bold, message, small line at the bottom) and each button under it, with a sample first name in place of the name chip.
 * Pure markup (no state): the language switch belongs to the builder.
 */
export function WhatsAppPreview({ message, lang, business, sample, t }: { message: Message; lang: DraftLang; business: string; sample: string; t: Say }) {
  const d = message.drafts[lang];
  const fill = (s: string) => fillName(s, sample);
  return (
    <div data-part="wa-preview" data-lang={lang} className="mx-auto w-full max-w-[360px] overflow-hidden rounded-xl border border-line bg-[#efeae2] dark:bg-[#0b141a]">
      <div className="flex items-center gap-2.5 bg-[#f0f2f5] px-3 py-2.5 text-[#111b21] dark:bg-[#1f2c34] dark:text-[#e9edef]">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-brand font-bold text-on-brand">
          {[...business][0] ?? "?"}
        </span>
        <span className="min-w-0">
          <b className="block truncate text-[15px] leading-tight">{business}</b>
          <span className="block text-xs text-[#54656f] dark:text-[#a9b6be]">{t("jobs.tb.s3.account")}</span>
        </span>
      </div>
      <div className="flex flex-col items-start gap-0.5 px-3 pb-4 pt-3.5">
        <span className="mb-2.5 self-center rounded-lg bg-[#f0f2f5] px-2.5 py-0.5 text-[11.5px] text-[#54656f] dark:bg-[#1f2c34] dark:text-[#a9b6be]">{t("jobs.tb.s3.today")}</span>
        <div lang={lang} data-part="wa-bubble" className="max-w-[92%] rounded-[2px_8px_8px_8px] bg-white px-2.5 pb-2 pt-2 text-[14.5px] leading-[1.4] text-[#111b21] shadow-[0_1px_1px_rgba(0,0,0,.12)] dark:bg-[#202c33] dark:text-[#e9edef]">
          {d.header ? <b className="mb-1 block">{fill(d.header)}</b> : null}
          <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{fill(d.body)}</p>
          {d.footer ? <p className="m-0 mt-1.5 text-[12.5px] text-[#54656f] dark:text-[#a9b6be]">{fill(d.footer)}</p> : null}
        </div>
        {d.buttons.map((b) => (
          <span key={b} data-part="wa-button" lang={lang} className="mt-[3px] w-[92%] rounded-xl bg-white px-2.5 py-2 text-center text-[14.5px] font-semibold text-[#0a6c8f] shadow-[0_1px_1px_rgba(0,0,0,.12)] dark:bg-[#202c33] dark:text-[#53bdeb]">
            {fill(b)}
          </span>
        ))}
      </div>
    </div>
  );
}
