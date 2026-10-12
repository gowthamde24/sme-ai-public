import { type RequirementField } from "@/lib/api/enquiries";

import { markClass, plainText } from "@/components/v2/app/ui";

import { segments } from "./spans";
import { makeT, type Words } from "@/components/v2/app/words";

/**
 * The stored text of an enquiry as PLAIN TEXT, with the words each field cites marked. A customer wrote it (contact details were
 * removed before it was stored); it is untrusted: every character below is a React text node (escaped), nothing here builds an
 * anchor, an image, a frame or markup from it. Line breaks are kept (white-space: pre-wrap) and long words wrap.
 */
export function EnquiryText({ body, fields, words }: { body: string; fields: RequirementField[]; words?: Words; }) {
  const t = makeT(words);
  const spans = fields
    .filter((f) => f.quote_start !== null && f.quote_end !== null && f.state !== "rejected")
    .map((f) => ({ start: f.quote_start as number, end: f.quote_end as number, id: f.id }));
  const labelOf = new Map(fields.map((f) => [f.id, t(`enq.field.${f.field_key}`)]));
  return (
    <p className={plainText} lang="und" data-testid="enquiry-text">
      {segments(body, spans).map((s, i) =>
        s.ids.length === 0 ? (
          <span key={i}>{s.text}</span>
        ) : (
          <mark key={i} className={markClass} title={t("enq.cited_by", { list: [...new Set(s.ids.map((id) => labelOf.get(id)))].join(", ") })}>
            {s.text}
          </mark>
        ),
      )}
    </p>
  );
}
