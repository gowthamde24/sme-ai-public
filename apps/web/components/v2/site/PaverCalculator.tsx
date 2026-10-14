"use client";

import { MessageCircle } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { btnPrimary, card } from "@/components/v2/site/ui";
import type { LeadResult } from "@/lib/site/lead";
import { computePaver, type AreaUnit, type PaverConfig } from "@/lib/site/paver";
import { formatRupees } from "@quote-engine/construction";

export type CalcWords = {
  area: string; unit: string; unitSqFt: string; unitSqM: string; product: string; wastage: string; price: string; priceHelp: string; result: string; pieces: string; pallets: string; trips: string; withWastage: string;
  material: string; delivered: string; bad: string; cta: string; ctaHelp: string; leadName: string; leadCity: string; leadConsent: string; privacy: string; errConsent: string; errName: string; errRate: string; errGeneric: string; unavailable: string;
};
type Props = { lang: string; config: PaverConfig; names: Readonly<Record<string, string>>; words: CalcWords; action: (input: unknown) => Promise<LeadResult>; privacyHref: string; chatAvailable: boolean };

const nf = new Intl.NumberFormat("en-IN");
const field = "min-h-12 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge";
const label = "mb-1.5 block text-sm font-semibold";
const WASTAGE = [0, 3, 5, 7, 10];

/**
 * The public paver calculator (job CM, blueprint section 7): area and paver type in, blocks, pallets and truck trips out, worked out by the SAME calculator the app's quote builder uses (packages/quote-engine/ts/construction.ts,
 * imported, not copied). A price is optional and is the visitor's own: with one it also shows the material amount before GST and transport. "Get exact quote on WhatsApp" asks for a name, an optional city and consent, then the
 * server works the numbers out again and hands back our WhatsApp address with the message filled in. Nothing typed here is stored. The words come from the server as props (this file holds no dictionary).
 */
export function PaverCalculator({ lang, config, names, words, action, privacyHref, chatAvailable }: Props) {
  const [area, setArea] = useState("1000");
  const [unit, setUnit] = useState<AreaUnit>("sq_ft");
  const [productId, setProductId] = useState(config.products[0]?.id ?? "");
  const [wastage, setWastage] = useState(config.default_wastage_bps / 100);
  const [price, setPrice] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [chat, setChat] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const areaNumber = Number(area.replace(/,/g, ""));
  const priceNumber = price.trim() === "" ? null : Number(price.replace(/,/g, ""));
  const result = useMemo(() => computePaver(config, { productId, area: areaNumber, unit, wastageBps: Math.round(wastage * 100), pricePerUnit: priceNumber !== null && Number.isFinite(priceNumber) ? priceNumber : null }, today), [config, productId, areaNumber, unit, wastage, priceNumber, today]);

  const errors: Record<string, string> = { consent: words.errConsent, name: words.errName, rate: words.errRate, unavailable: words.unavailable, invalid: words.errGeneric };
  const submit = () => {
    setProblem(null);
    start(async () => {
      try {
        const out = await action({ lang, productId, area: areaNumber, unit, name, city, consent });
        if (out.ok) {
          setChat(out.url);
          window.location.assign(out.url);
        } else setProblem(errors[out.error] ?? words.errGeneric);
      } catch {
        setProblem(words.errGeneric);
      }
    });
  };

  return (
    <div className={`${card} grid gap-6 lg:grid-cols-2`} data-part="paver-calculator">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <label htmlFor="pc-area" className={label}>{words.area}</label>
            <input id="pc-area" inputMode="decimal" autoComplete="off" value={area} onChange={(e) => setArea(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="pc-unit" className={label}>{words.unit}</label>
            <select id="pc-unit" value={unit} onChange={(e) => setUnit(e.target.value as AreaUnit)} className={field}>
              <option value="sq_ft">{words.unitSqFt}</option>
              <option value="sq_m">{words.unitSqM}</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="pc-product" className={label}>{words.product}</label>
          <select id="pc-product" value={productId} onChange={(e) => setProductId(e.target.value)} className={field}>
            {config.products.map((p) => (
              <option key={p.id} value={p.id}>{names[p.id]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pc-wastage" className={label}>{words.wastage}</label>
          <select id="pc-wastage" value={wastage} onChange={(e) => setWastage(Number(e.target.value))} className={field}>
            {[...new Set([...WASTAGE, config.default_wastage_bps / 100])].sort((a, b) => a - b).map((w) => (
              <option key={w} value={w}>{w}%</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pc-price" className={label}>{words.price.replace("{unit}", unit === "sq_ft" ? words.unitSqFt : words.unitSqM)}</label>
          <input id="pc-price" inputMode="decimal" autoComplete="off" value={price} onChange={(e) => setPrice(e.target.value)} className={field} />
          <p className="mt-1 text-sm text-muted">{words.priceHelp}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div role="status" aria-live="polite" className="rounded-xl bg-surface-2 p-4" data-part="paver-result">
          {result ? (
            <>
              <p className="text-sm font-semibold text-muted">{words.result}</p>
              <p className="mt-1 font-display text-3xl font-bold tabular-nums">{nf.format(result.pieces)} <span className="text-lg font-semibold">{words.pieces}</span></p>
              <p className="text-sm text-muted">{words.withWastage}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-base">
                <div><dt className="text-sm text-muted">{words.pallets}</dt><dd className="font-semibold tabular-nums">{nf.format(result.pallets)}</dd></div>
                <div><dt className="text-sm text-muted">{words.trips}</dt><dd className="font-semibold tabular-nums">{nf.format(result.trips)}</dd></div>
                <div><dt className="text-sm text-muted">{words.delivered}</dt><dd className="font-semibold tabular-nums">{nf.format(result.delivered_area_x100 / 100)} {unit === "sq_ft" ? words.unitSqFt : words.unitSqM}</dd></div>
                {result.material_paise !== null ? <div><dt className="text-sm text-muted">{words.material}</dt><dd className="font-semibold tabular-nums">{formatRupees(result.material_paise)}</dd></div> : null}
              </dl>
            </>
          ) : (
            <p className="text-base text-muted">{words.bad}</p>
          )}
        </div>

        {chatAvailable ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <p className="text-sm text-muted">{words.ctaHelp}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="pc-name" className={label}>{words.leadName}</label>
                <input id="pc-name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="pc-city" className={label}>{words.leadCity}</label>
                <input id="pc-city" autoComplete="address-level2" maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} className={field} />
              </div>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-6 shrink-0 accent-brand-text" />
              <span>
                {words.leadConsent} <a href={privacyHref} target="_blank" rel="noopener" className="font-semibold text-brand-text underline underline-offset-2">{words.privacy}</a>
              </span>
            </label>
            {problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm font-medium text-danger-text">{problem}</p> : null}
            <button type="submit" disabled={pending || !result} className={`${btnPrimary} disabled:opacity-60`}>
              <MessageCircle className="size-5" aria-hidden="true" />
              {words.cta}
            </button>
            {chat ? <a href={chat} className="text-sm font-semibold text-brand-text underline underline-offset-2">{words.cta}</a> : null}
          </form>
        ) : (
          <p className="text-sm text-muted">{words.unavailable}</p>
        )}
      </div>
    </div>
  );
}
