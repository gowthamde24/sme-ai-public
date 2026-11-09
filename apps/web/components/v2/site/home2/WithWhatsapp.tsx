import { Fragment } from "react";

import { SITE_WHATSAPP, siteWhatsappHref } from "@/lib/site/whatsapp";

/** A site string with `{whatsapp}` in it: the words as they are, and our number (lib/site/whatsapp.ts, the one place it is set) as a link to a chat in its place. Server markup. */
export function WithWhatsapp({ text }: { text: string }) {
  const parts = text.split("{whatsapp}");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? (
            <a href={siteWhatsappHref()} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-ink underline decoration-line underline-offset-4 hover:text-brand-text" data-part="whatsapp">
              {SITE_WHATSAPP}
            </a>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}
