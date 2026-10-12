import { detailsBox, factorGrid, factorItem, hintInline, mutedText, summaryLine } from "@/components/v2/app/ui";
import { makeT, type Say, type Words } from "@/components/v2/app/words";

/**
 * "How this score was worked out", in plain words. The API sends the factors of a score as a LIST of
 * { id, points, max_points, unknown }; an older shape (a map keyed by id) is still drawn. Anything else draws nothing.
 *
 * "Not known yet" is deliberately not a bad mark: the item scores 0 for now because nobody has told the system the answer
 * (for example the buyer type), and the highest score the lead can reach with what is known is shown next to the heading.
 */
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

/** The words for a factor or flag code (rev.factor.<id>, rev.flag.<id>); a code this screen does not know yet shows as plain words. */
function label(t: Say, group: "factor" | "flag", id: string): string {
  const key = `rev.${group}.${id}`;
  const text = t(key);
  return text === key ? id.replaceAll("_", " ") : text;
}

export function FactorBreakdown({
  factors,
  flags,
  maxReachable, words,
}: {
  factors: unknown;
  flags?: unknown;
  maxReachable: number | null; words?: Words;
}) {
  const t = makeT(words);
  const list = parseFactors(factors);
  if (list.length === 0) return null;
  const notes = Array.isArray(flags) ? flags.filter((f): f is string => typeof f === "string") : [];
  return (
    <details className={detailsBox}>
      <summary className={summaryLine}>
        {t("rev.how_worked_out")}
        {maxReachable !== null ? " " + t("rev.highest_possible", { n: maxReachable }) : ""}
      </summary>
      <ul className={factorGrid}>
        {list.map((f) => (
          <li key={f.id} className={factorItem} data-unknown={f.unknown ? "true" : undefined}>
            <strong>{label(t, "factor", f.id)}</strong>:{" "}
            {f.unknown ? (
              <span>
                {t("rev.not_known")} <span className={hintInline}>{t("rev.not_known_hint", { max: f.maxPoints ?? "?" })}</span>
              </span>
            ) : (
              <span>
                {t("rev.points_line", { points: f.points, max: f.maxPoints ?? "?" })}
              </span>
            )}
          </li>
        ))}
      </ul>
      {notes.length > 0 && (
        <p className={mutedText}>
          {t("rev.things_to_know", { list: notes.map((n) => label(t, "flag", n)).join("; ") })}
        </p>
      )}
      <p className={mutedText}>
        {t("rev.not_known_yet_is_not_a")}
      </p>
    </details>
  );
}
