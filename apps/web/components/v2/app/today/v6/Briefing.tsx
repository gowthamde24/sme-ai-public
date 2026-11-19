import Link from "next/link";
import * as React from "react";

import { makeT, type Words } from "../../words";
import { linePieces, type BandFacts, type TopDecision } from "./band-data";

/** A string with `{name}` places made into pieces of JSX (a number in bold, a link): the words stay whole sentences in the string store. */
export function rich(template: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{\w+\})/g).map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece);
    return m && m[1] in parts ? <React.Fragment key={i}>{parts[m[1]]}</React.Fragment> : <React.Fragment key={i}>{piece}</React.Fragment>;
  });
}

/** The briefing (17px): today's facts from the business's own data, the key ones bright, and the top decision as an underlined link (a quote opens the quote; otherwise the list). The Approve button lives in Needs you, not here. */
/** The first sentence of the briefing: the new enquiries and today's visits. */
export function briefingFirst(facts: BandFacts, words: Words): React.ReactNode {
  const t = makeT(words);
  const pieces = linePieces(facts);
  const enq = pieces.find((x) => x.key === "enq");
  const vis = pieces.find((x) => x.key === "visits");
  const enqNode = enq ? <b>{t(`tv6.line.enq.${enq.n === 1 ? "one" : "other"}`, { n: enq.n })}</b> : null;
  const visNode = vis ? <b className="ds-hl">{t(`tv6.line.visits.${vis.n === 1 ? "one" : "other"}`, { n: vis.n })}</b> : null;
  return enqNode && visNode ? rich(t("tv6.brief.both"), { enq: enqNode, visits: visNode }) : enqNode ? rich(t("tv6.brief.enq"), { enq: enqNode }) : visNode ? rich(t("tv6.brief.visits"), { visits: visNode }) : null;
}

/** The second sentence: the quote at the top (a link that opens it), else how many things wait for the person. */
export function briefingSecond(top: TopDecision | null, waiting: number | null, words: Words): React.ReactNode {
  const t = makeT(words);
  if (top) return rich(t("tv6.brief.quote"), { link: <Link href={top.href}>{t("tv6.brief.quote.link", { amount: top.amountText, name: top.name })}</Link> });
  if (waiting !== null && waiting > 0) return rich(t(waiting === 1 ? "tv6.brief.waiting.one" : "tv6.brief.waiting.other"), { link: <a href="#needs-you">{t(waiting === 1 ? "tv6.brief.waiting.one.link" : "tv6.brief.waiting.other.link", { n: waiting })}</a> });
  if (waiting === 0) return t("tv6.brief.none");
  return null;
}

export function Briefing({ facts, top, waiting, words }: { facts: BandFacts; top: TopDecision | null; waiting: number | null; words: Words }) {
  const first = briefingFirst(facts, words);
  const second = briefingSecond(top, waiting, words);
  if (!first && !second) return null;
  return (
    <p data-part="briefing" className="ds-brief text-balance">
      {first}
      {first && second ? " " : null}
      {second}
    </p>
  );
}

/**
 * The briefing painted from C1's small `GET /today/briefing` (counts only, about 150 bytes) before the big Today reads arrive: the first sentence is final; the second slot is `second` (a streamed part that is
 * replaced by the quote sentence when the finished list is read; its fallback is the same sentence made from the counts, so nothing moves).
 */
export function BriefingFast({ facts, second, words }: { facts: BandFacts; second: React.ReactNode; words: Words }) {
  const first = briefingFirst(facts, words);
  return (
    <p data-part="briefing" className="ds-brief text-balance">
      {first}
      {first ? " " : null}
      {second}
    </p>
  );
}
