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
export function Briefing({ facts, top, waiting, words }: { facts: BandFacts; top: TopDecision | null; waiting: number | null; words: Words }) {
  const t = makeT(words);
  const pieces = linePieces(facts);
  const enq = pieces.find((x) => x.key === "enq");
  const vis = pieces.find((x) => x.key === "visits");
  const enqNode = enq ? <b>{t(`tv6.line.enq.${enq.n === 1 ? "one" : "other"}`, { n: enq.n })}</b> : null;
  const visNode = vis ? <b className="ds-hl">{t(`tv6.line.visits.${vis.n === 1 ? "one" : "other"}`, { n: vis.n })}</b> : null;
  const first = enqNode && visNode ? rich(t("tv6.brief.both"), { enq: enqNode, visits: visNode }) : enqNode ? rich(t("tv6.brief.enq"), { enq: enqNode }) : visNode ? rich(t("tv6.brief.visits"), { visits: visNode }) : null;
  let second: React.ReactNode = null;
  if (top) second = rich(t("tv6.brief.quote"), { link: <Link href={top.href}>{t("tv6.brief.quote.link", { amount: top.amountText, name: top.name })}</Link> });
  else if (waiting !== null && waiting > 0) second = rich(t(waiting === 1 ? "tv6.brief.waiting.one" : "tv6.brief.waiting.other"), { link: <a href="#needs-you">{t(waiting === 1 ? "tv6.brief.waiting.one.link" : "tv6.brief.waiting.other.link", { n: waiting })}</a> });
  else if (waiting === 0) second = t("tv6.brief.none");
  if (!first && !second) return null;
  return (
    <p data-part="briefing" className="ds-brief text-balance">
      {first}
      {first && second ? " " : null}
      {second}
    </p>
  );
}
