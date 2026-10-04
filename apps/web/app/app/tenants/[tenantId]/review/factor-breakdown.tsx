/**
 * "How this score was worked out", in plain words. The API sends the factors of a score as a LIST of
 * { id, points, max_points, unknown }; an older shape (a map keyed by id) is still drawn. Anything else draws nothing.
 *
 * "Not known yet" is deliberately not a bad mark: the item scores 0 for now because nobody has told the system the answer
 * (for example the buyer type), and the highest score the lead can reach with what is known is shown next to the heading.
 */
export const FACTOR_LABELS: Record<string, string> = {
  silk_saree_fit: "Sells silk sarees",
  buyer_type_fit: "Type of buyer",
  geography_fit: "Location",
  business_scale: "Size of the business",
  reachability: "Can we reach them",
  evidence_quality: "Evidence we have",
};

export const FLAG_LABELS: Record<string, string> = {
  no_saree_evidence: "Nothing yet shows they sell sarees",
  no_evidence: "No evidence attached yet",
  existing_customer: "Already a customer",
};

export type Factor = { id: string; points: number; maxPoints: number | null; unknown: boolean };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function one(id: unknown, raw: unknown): Factor | null {
  if (typeof id !== "string" || !isRecord(raw)) return null;
  const points = typeof raw.points === "number" ? raw.points : 0;
  const max = typeof raw.max_points === "number" ? raw.max_points : null;
  return { id, points, maxPoints: max, unknown: raw.unknown === true };
}

export function parseFactors(factors: unknown): Factor[] {
  if (Array.isArray(factors))
    return factors.flatMap((f) => (isRecord(f) ? [one(f.id, f)] : [])).filter((f): f is Factor => f !== null);
  if (isRecord(factors))
    return Object.entries(factors)
      .map(([id, f]) => one(id, f))
      .filter((f): f is Factor => f !== null);
  return [];
}

function prettify(id: string): string {
  return FACTOR_LABELS[id] ?? id.replaceAll("_", " ");
}

export function FactorBreakdown({
  factors,
  flags,
  maxReachable,
}: {
  factors: unknown;
  flags?: unknown;
  maxReachable: number | null;
}) {
  const list = parseFactors(factors);
  if (list.length === 0) return null;
  const notes = Array.isArray(flags) ? flags.filter((f): f is string => typeof f === "string") : [];
  return (
    <details className="factor-breakdown">
      <summary className="tap">
        How this score was worked out
        {maxReachable !== null ? ` (highest possible with what we know: ${maxReachable} of 100)` : ""}
      </summary>
      <ul className="factors-grid">
        {list.map((f) => (
          <li key={f.id} className="factor-item" data-unknown={f.unknown ? "true" : undefined}>
            <strong>{prettify(f.id)}</strong>:{" "}
            {f.unknown ? (
              <span>
                not known yet <span className="hint">(0 of {f.maxPoints ?? "?"} for now; tell the system to count it)</span>
              </span>
            ) : (
              <span>
                {f.points} of {f.maxPoints ?? "?"} points
              </span>
            )}
          </li>
        ))}
      </ul>
      {notes.length > 0 && (
        <p className="hint">
          Things to know: {notes.map((n) => FLAG_LABELS[n] ?? n.replaceAll("_", " ")).join("; ")}.
        </p>
      )}
      <p className="hint">
        &quot;Not known yet&quot; is not a bad mark: nobody has given the system that information, so it counts 0 for now.
      </p>
    </details>
  );
}
