"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { CalcOut } from "@contracts";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary, secondary } from "../visits/styles";
import { QuoteFigures } from "./QuoteFigures";
import { figuresFromCalc } from "./figures";

export type BuilderLine = { lineNo: number; title: string; measure: string; area: { areaX100: number; areaUnit: "sq_ft" | "sq_m" | null } | null };
export type BuilderItem = { id: string; name: string; unit: string; priceText: string | null; missing: string[] };
export type BuilderSite = { id: string; label: string };
type Refused = { ok: false; error: string; mfa?: boolean; stale?: boolean };
export type BuilderActions = {
  preview: (picks: { line_no: number; item_id: string }[], siteId: string | null) => Promise<{ ok: true; result: CalcOut; databaseAgrees: boolean; validUntil: string } | Refused>;
  draft: (quoteId: string, picks: { line_no: number; item_id: string }[], siteId: string | null) => Promise<{ ok: true; quoteId: string } | Refused>;
};

/**
 * Make a quote from a confirmed requirement (job CO). For each line of the requirement the person picks the product; the site (where the truck goes) is optional but decides the transport when freight is by the
 * kilometre. "Show the figures" asks the server for the numbers the database would use, run through the calculator (the same code as the public calculator); nothing is stored. "Save as a draft" keeps those figures
 * as a draft quote, which waits for the Owner or an Admin to approve it. Changing a pick throws the shown figures away, so a number on the screen is always the one for the picks above it.
 */
export function QuoteBuilder(p: { base: string; requirementId: string; newQuoteId: string; lines: readonly BuilderLine[]; items: readonly BuilderItem[]; sites: readonly BuilderSite[]; words: TodayWords; actions: BuilderActions; go?: (href: string) => void }) {
  const { words } = p;
  const router = useRouter();
  const go = p.go ?? ((href: string) => router.push(href));
  const [picks, setPicks] = React.useState<Record<number, string>>(() => {
    const quotable = p.items.filter((i) => i.missing.length === 0);
    return p.lines.length === 1 && quotable.length === 1 ? { [p.lines[0].lineNo]: quotable[0].id } : {};
  });
  const [site, setSite] = React.useState("");
  const [busy, setBusy] = React.useState<"preview" | "draft" | null>(null);
  const [shown, setShown] = React.useState<{ result: CalcOut; agrees: boolean } | null>(null);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const complete = p.lines.every((l) => picks[l.lineNo]);
  const list = () => p.lines.map((l) => ({ line_no: l.lineNo, item_id: picks[l.lineNo] }));
  const reset = () => {
    setShown(null);
    setProblem(null);
  };

  async function preview() {
    if (busy || !complete) return;
    reset();
    setBusy("preview");
    const out = await p.actions.preview(list(), site || null);
    setBusy(null);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setShown({ result: out.result, agrees: out.databaseAgrees });
  }
  async function draft() {
    if (busy || !shown) return;
    setProblem(null);
    setBusy("draft");
    const out = await p.actions.draft(p.newQuoteId, list(), site || null);
    if (!out.ok) {
      setBusy(null);
      return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    }
    go(`${p.base}/quotes/${out.quoteId}?made=1`);
  }

  const figures = shown ? figuresFromCalc(shown.result, p.lines.map((l) => l.area)) : null;
  return (
    <div data-screen="quote-builder" className="flex max-w-3xl flex-col gap-5">
      {p.items.length === 0 ? (
        <p role="note" className="rounded-lg border border-amber-text bg-amber-bg p-3 text-base font-medium text-amber-text">
          {say(words, "mat.b.noitems")} <Link href={`${p.base}/materials/new`} className="font-semibold underline">{say(words, "mat.products.add")}</Link>
        </p>
      ) : null}
      {p.lines.map((l) => {
        const chosen = p.items.find((i) => i.id === picks[l.lineNo]);
        return (
          <fieldset key={l.lineNo} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line p-4" data-line={l.lineNo}>
            <legend className="px-1 font-display text-lg font-semibold">{say(words, "mat.b.line", { n: l.lineNo })}</legend>
            <p className="text-base font-semibold [overflow-wrap:anywhere]">{l.title}</p>
            <p className="text-sm text-muted [overflow-wrap:anywhere]">{l.measure}</p>
            <label htmlFor={`pick-${l.lineNo}`} className={label}>{say(words, "mat.b.pick")}</label>
            <select id={`pick-${l.lineNo}`} value={picks[l.lineNo] ?? ""} disabled={busy !== null} onChange={(e) => { setPicks((c) => ({ ...c, [l.lineNo]: e.target.value })); reset(); }} className={field}>
              <option value="">{say(words, "mat.b.choose")}</option>
              {p.items.map((i) => (
                <option key={i.id} value={i.id}>{i.name}{i.priceText ? ` · ${i.priceText}` : ""}</option>
              ))}
            </select>
            {chosen && chosen.missing.length > 0 ? (
              <p role="note" className="text-sm font-medium text-amber-text">
                {say(words, "mat.b.missing", { what: chosen.missing.map((c) => say(words, `mat.missing.${c}`)).join(", ") })}{" "}
                <Link href={`${p.base}/materials/${chosen.id}/edit`} className="font-semibold underline">{say(words, "mat.product.edit")}</Link>
              </p>
            ) : null}
          </fieldset>
        );
      })}
      {p.sites.length > 0 ? (
        <div>
          <label htmlFor="b-site" className={label}>{say(words, "mat.b.site")}</label>
          <select id="b-site" value={site} disabled={busy !== null} onChange={(e) => { setSite(e.target.value); reset(); }} aria-describedby="b-site-help" className={field}>
            <option value="">{say(words, "mat.b.nosite")}</option>
            {p.sites.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <p id="b-site-help" className={help}>{say(words, "mat.b.site.help")}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={busy !== null || !complete || p.items.length === 0} onClick={() => void preview()}>
          {busy === "preview" ? say(words, "today.act.working") : say(words, "mat.b.preview")}
        </button>
        {complete ? null : <span className={help}>{say(words, "mat.b.pickall")}</span>}
      </div>
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      {shown && figures ? (
        <section aria-labelledby="b-fig" className="flex flex-col gap-3" data-part="preview">
          <h2 id="b-fig" className="font-display text-xl font-bold">{say(words, "mat.b.figures")}</h2>
          <p role="note" className={okLine}>{say(words, shown.agrees ? "mat.b.agrees" : "mat.b.differs")}</p>
          <QuoteFigures figures={figures} words={words} />
          <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 md:bottom-4">
            <button type="button" className={primary} disabled={busy !== null || !shown.agrees} onClick={() => void draft()}>
              {busy === "draft" ? say(words, "today.act.working") : say(words, "mat.b.draft")}
            </button>
            <button type="button" className={secondary} disabled={busy !== null} onClick={reset}>{say(words, "mat.b.discard")}</button>
            <span className={help}>{say(words, "mat.b.draft.help")}</span>
          </div>
        </section>
      ) : shown ? (
        <p role="alert" className={errorLine}>{say(words, "mat.b.rejected")}</p>
      ) : null}
    </div>
  );
}
