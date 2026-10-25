import type { FailureKind } from "@/lib/api/failure";

import { AgentMark } from "../mark/AgentMark";
import { RefreshRetry } from "../robust/RetryButton";
import { makeT, type Words } from "../words";
import { card, h2 } from "./kit";

/**
 * When one part of a page could not be read (job CC): in that part's place, the owl and one closed sentence, so the rest of the page stays usable. A refused call (403) says "not open to you", a rate limit (429) says to wait,
 * anything else says the part could not be loaded; all but the refusal offer "Try again". It never shows what the API said. (`words` carries the `problem.*`, `apierr.*` keys.)
 */
export function PartProblem({ kind, words, retryAfter, title }: { kind: FailureKind; words: Words; retryAfter?: number; title?: string }) {
  const t = makeT(words);
  const forbidden = kind === "forbidden" || kind === "mfa";
  const limited = kind === "rate_limited";
  return (
    <section className={card} data-problem={forbidden ? 403 : limited ? 429 : 500}>
      <div className="flex items-start gap-3">
        <AgentMark px={48} mood="idle" className="size-12" />
        <div className="min-w-0">
          <h2 className={h2}>{title ?? t(forbidden ? "problem.403.title" : limited ? "problem.429.title" : "problem.500.title")}</h2>
          <p className="mt-1 text-base text-muted">{forbidden ? t("problem.403.body") : limited ? (retryAfter !== undefined && retryAfter <= 300 ? t("apierr.rate.n", { n: retryAfter }) : t("problem.429.body")) : t("apierr.part_failed")}</p>
        </div>
      </div>
      {forbidden ? null : <RefreshRetry />}
    </section>
  );
}
