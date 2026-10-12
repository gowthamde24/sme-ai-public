import type { ClaimEvidenceOut } from "@/lib/api/agents";
import { listItemCard, listPlain, mutedText, quoteBlock, wrapAnywhere } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

/** Said next to every quote: what has and has not been checked. */
export const QUOTE_CHECK_LABEL = "Quote checked by the agent runtime, not by the database.";

/**
 * What a suggestion rests on: the quote and where it came from.
 *
 * Everything here is UNTRUSTED text: a model chose the quote from a page a stranger controls. It is rendered as PLAIN TEXT
 * in ordinary elements (React escapes it); the source is a host and a path shown as text, NEVER a link, an image or a frame,
 * so nothing a page says can be opened or loaded from here. Long words wrap (`overflow-wrap: anywhere`) so a phone never
 * scrolls sideways.
 */
export function SuggestionEvidence({ evidence, words }: { evidence: ClaimEvidenceOut[] | undefined; words?: Words; }) {
  const t = makeT(words);
  if (!evidence || evidence.length === 0)
    return <p className={mutedText}>{t("ws.no_evidence_is_attached_to_this")}</p>;
  return (
    <ul className={`${listPlain} ${wrapAnywhere}`}>
      {evidence.map((e, i) => (
        <li key={i} className={listItemCard}>
          <p className={mutedText}>
            {t(`ws.stance.${e.stance}`)} · {e.kind === "web_page" ? t("ws.web_page") : e.kind}
            {e.host ? " " + t("ws.source_line", { where: `${e.host}${e.path ?? ""}` }) : ""}
          </p>
          {e.quote ? (
            <blockquote className={quoteBlock}>{e.quote}</blockquote>
          ) : (
            <p className={mutedText}>{t("ws.no_quote")}</p>
          )}
          <p className={mutedText}>{t("ws.quote_checked")}</p>
        </li>
      ))}
    </ul>
  );
}
