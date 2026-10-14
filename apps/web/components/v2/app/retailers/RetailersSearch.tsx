"use client";

import Link from "next/link";
import { useId, useState } from "react";

import type { PlaceCard, SearchResult } from "@/lib/api/retailers";
import { queryProblem } from "@/lib/api/retailers-checks";

import { FailureNote } from "../cc/FailureNote";
import { card, field, h2, h3, help, label as labelClass, muted, okLine, primary, quiet, secondary, type Failed, type Reply } from "../cc/kit";
import { postJson } from "../cc/post";
import { PlushStill } from "../owl/PlushStill";
import { StateDot } from "../owl/StateDot";
import { makeT, type Words } from "../words";

export type ConfirmResult = { ok: true; data: { lead_id: string; created: boolean } } | Failed;
export type SearchStatus = { enabled: boolean; used: number | null; limit: number | null } | "unknown";

const ASSISTANT_CODES = ["agents_disabled", "ai_paused_until", "run_limit_reached", "assistant_unavailable", "forbidden"];

/**
 * Find retailers (job CC, screen 3): a search of Google Maps through the official Places service (the assistant's map tool), a list of the shops found, and a way to keep one as a lead. The cards are shown now and kept
 * nowhere: what is saved is what the person types and the place's ID. Every card says where it comes from ("Google Maps") and links to Maps. Nothing is sent to anyone from here.
 */
export function RetailersSearch({ tenantId, words, status, confirm }: { tenantId: string; words: Words; status: SearchStatus; confirm: (placeId: string, name: string, city: string, region: string) => Promise<ConfirmResult> }) {
  const t = makeT(words);
  const id = useId();
  const [kind, setKind] = useState(t("rtl.kind.default"));
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const off = status !== "unknown" && !status.enabled;

  async function search() {
    const p = queryProblem(kind, city);
    setProblem(p ? t(`rtl.err.${p}`) : null);
    if (p) return;
    setBusy(true);
    setFailure(null);
    setResult(null);
    const r: Reply<SearchResult> = await postJson(`/app/tenants/${tenantId}/retailers/search`, { kind: kind.trim(), city: city.trim(), messageId: crypto.randomUUID() });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setResult(r.data);
  }
  const own = (code: string) => (ASSISTANT_CODES.includes(code) ? t(`rtl.err.${code}`) : null);
  const refused = result?.error ?? null;

  return (
    <div className="flex flex-col gap-5" data-retailers="">
      <section className={card} aria-labelledby={`${id}-status`}>
        <h2 id={`${id}-status`} className={h3}>
          {t("rtl.status.title")}
        </h2>
        <p className="text-base" data-retailers-status="">
          {status === "unknown" ? t("rtl.status.unknown") : status.enabled ? (status.used !== null && status.limit !== null ? t("rtl.status.on_limit", { used: status.used, limit: status.limit }) : t("rtl.status.on")) : t("rtl.status.off")}
        </p>
      </section>

      <section className={card} aria-labelledby={`${id}-form`}>
        <h2 id={`${id}-form`} className={h2}>
          {t("rtl.search.title")}
        </h2>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-kind`} className={labelClass}>
                {t("rtl.kind.label")}
              </label>
              <input id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)} maxLength={100} className={field} />
            </div>
            <div>
              <label htmlFor={`${id}-city`} className={labelClass}>
                {t("rtl.city.label")}
              </label>
              <input id={`${id}-city`} value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} className={field} />
            </div>
          </div>
          <p className={help}>{t("rtl.hint")}</p>
          {problem ? (
            <p role="alert" className="text-sm font-medium text-red-text">
              {problem}
            </p>
          ) : null}
          <div>
            <button type="submit" disabled={busy || off} className={primary}>
              {busy ? t("rtl.btn.searching") : t("rtl.btn.search")}
            </button>
          </div>
          {off ? <p className={help}>{t("rtl.status.off")}</p> : null}
        </form>
      </section>

      {busy ? (
        <section className={`${card} flex-row items-center`} role="status" aria-live="polite">
          <PlushStill agent="researcher" px={48} mood="thinking" className="size-12" />
          <StateDot state="working" />
          <p className="text-base">{t("rtl.searching")}</p>
        </section>
      ) : null}
      <FailureNote failure={failure} words={words} own={own} />

      {result ? (
        <section className="flex flex-col gap-3" aria-labelledby={`${id}-results`} data-retailers-results="">
          <h2 id={`${id}-results`} className={h2}>
            {t("rtl.results.title")}
          </h2>
          {refused ? (
            <p role="alert" className="rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-base font-medium text-amber-text">
              {own(refused) ?? t("rtl.err.generic")}
            </p>
          ) : null}
          {result.cards.length === 0 && !refused ? <p className="text-base text-muted">{t("rtl.results.empty")}</p> : null}
          {result.cards.length > 0 ? <p className={muted}>{t("rtl.results.note")}</p> : null}
          <ul className="grid gap-3 sm:grid-cols-2">
            {result.cards.map((c) => (
              <li key={c.id}>
                <Place tenantId={tenantId} words={words} place={c} defaultCity={city} confirm={confirm} />
              </li>
            ))}
          </ul>
          {result.text ? (
            <details className="rounded-xl border border-line bg-surface p-3">
              <summary className="min-h-11 cursor-pointer text-base font-semibold text-brand-text">{t("rtl.answer.title")}</summary>
              <p className="mt-2 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{result.text}</p>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Place({ tenantId, words, place, defaultCity, confirm }: { tenantId: string; words: Words; place: PlaceCard; defaultCity: string; confirm: (placeId: string, name: string, city: string, region: string) => Promise<ConfirmResult> }) {
  const t = makeT(words);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState(defaultCity);
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [saved, setSaved] = useState<{ lead_id: string; created: boolean } | null>(null);

  async function save() {
    if (name.trim() === "") {
      setFailure({ ok: false, kind: "invalid", error: t("rtl.form.name_needed") });
      return;
    }
    setBusy(true);
    setFailure(null);
    const r = await confirm(place.id, name, city, region);
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setSaved(r.data);
    setOpen(false);
  }

  return (
    <article className={card} aria-labelledby={`${id}-n`} data-place="">
      <h3 id={`${id}-n`} className={h3}>
        {place.label}
      </h3>
      <p className="text-sm text-muted">{t("rtl.results.source")}</p>
      {place.url ? (
        <a href={place.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
          {t("rtl.card.view")}
        </a>
      ) : null}
      {saved ? (
        <div className="flex flex-col gap-2">
          <p role="status" className={okLine}>
            {saved.created ? t("rtl.form.saved") : t("rtl.form.existing")}
          </p>
          <Link href={`/app/tenants/${tenantId}/leads/${saved.lead_id}`} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
            {t("rtl.form.open")}
          </Link>
        </div>
      ) : open ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h4 className="font-display text-base font-bold">{t("rtl.form.title")}</h4>
          <p className={help}>{t("rtl.form.help")}</p>
          <div>
            <label htmlFor={`${id}-name`} className={labelClass}>
              {t("rtl.form.name")}
            </label>
            <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" className={field} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-city`} className={labelClass}>
                {t("rtl.form.city")}
              </label>
              <input id={`${id}-city`} value={city} onChange={(e) => setCity(e.target.value)} maxLength={100} autoComplete="off" className={field} />
            </div>
            <div>
              <label htmlFor={`${id}-region`} className={labelClass}>
                {t("rtl.form.region")}
              </label>
              <input id={`${id}-region`} value={region} onChange={(e) => setRegion(e.target.value)} maxLength={100} autoComplete="off" className={field} />
            </div>
          </div>
          <FailureNote failure={failure} words={words} />
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className={primary}>
              {busy ? t("dta.btn.working") : t("rtl.form.save")}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className={quiet}>
              {t("rtl.form.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" onClick={() => setOpen(true)} className={secondary}>
            {t("rtl.card.add")}
          </button>
        </div>
      )}
    </article>
  );
}
