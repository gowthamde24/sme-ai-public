import type { ClaimEvidenceOut } from "@/lib/api/agents";

/** Said next to every quote: what has and has not been checked. */
export const QUOTE_CHECK_LABEL = "Quote checked by the agent runtime, not by the database.";

const STANCE_LABELS: Record<ClaimEvidenceOut["stance"], string> = {
  supports: "Supports",
  context: "Context",
  contradicts: "Contradicts",
};

/**
 * What a suggestion rests on: the quote and where it came from.
 *
 * Everything here is UNTRUSTED text: a model chose the quote from a page a stranger controls. It is rendered as PLAIN TEXT
 * in ordinary elements (React escapes it); the source is a host and a path shown as text, NEVER a link, an image or a frame,
 * so nothing a page says can be opened or loaded from here. Long words wrap (`overflow-wrap: anywhere`) so a phone never
 * scrolls sideways.
 */
export function SuggestionEvidence({ evidence }: { evidence: ClaimEvidenceOut[] | undefined }) {
  if (!evidence || evidence.length === 0)
    return <p className="hint">No evidence is attached to this suggestion.</p>;
  return (
    <ul className="evidence-list" style={{ overflowWrap: "anywhere" }}>
      {evidence.map((e, i) => (
        <li key={i}>
          <p className="hint">
            {STANCE_LABELS[e.stance]} · {e.kind === "web_page" ? "web page" : e.kind}
            {e.host ? ` · source: ${e.host}${e.path ?? ""}` : ""}
          </p>
          {e.quote ? (
            <blockquote style={{ margin: "0.25rem 0", overflowWrap: "anywhere" }}>{e.quote}</blockquote>
          ) : (
            <p className="hint">(no quote)</p>
          )}
          <p className="hint">{QUOTE_CHECK_LABEL}</p>
        </li>
      ))}
    </ul>
  );
}
