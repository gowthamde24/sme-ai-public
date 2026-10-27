import Link from "next/link";
import type { ReactNode } from "react";

import { mutedText } from "../ui";
import { makeT, type Words } from "../words";

/**
 * The frame of the Lead Desk setup (night 4, part A2): six steps, a progress bar, the title and one sentence of the step, a way to skip it and a way back. A plain server part: every step is its own address (`?step=N`), so the back button,
 * a refresh and a bookmark all work, and nothing is lost on a phone. A step can always be skipped; nothing here is required to use the product.
 */
export const STEPS = 6;
export function WizardFrame({ words, step, base, children }: { words: Words; step: number; base: string; children: ReactNode }) {
  const t = makeT(words);
  const at = (n: number) => `${base}/lead-setup?step=${n}`;
  return (
    <div data-part="wizard" data-step={step} className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold text-muted" aria-live="polite">
          {t("ld.wiz.step", { n: step, total: STEPS })}
        </p>
        <progress value={step} max={STEPS} aria-label={t("ld.wiz.step", { n: step, total: STEPS })} className="mt-1 h-2 w-full accent-brand-edge" />
        <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {Array.from({ length: STEPS }, (_, i) => i + 1).map((n) => (
            <li key={n}>
              <Link href={at(n)} aria-current={n === step ? "step" : undefined} className={n === step ? "font-semibold text-brand-text underline" : "text-muted hover:underline"}>
                {n}. {t(`ld.wiz.s${n}.short` as "ld.wiz.s1.short")}
              </Link>
            </li>
          ))}
        </ol>
      </div>
      <h2 className="font-display text-2xl font-bold leading-tight">{t(`ld.wiz.s${step}.title` as "ld.wiz.s1.title")}</h2>
      <p className="text-base">{t(`ld.wiz.s${step}.sub` as "ld.wiz.s1.sub")}</p>
      {children}
      <nav aria-label={t("ld.wiz.nav")} className="mt-2 flex flex-wrap items-center gap-4 border-t border-line pt-4">
        {step > 1 ? (
          <Link href={at(step - 1)} className="min-h-11 py-2 text-base font-semibold text-brand-text hover:underline">
            {t("ld.wiz.back")}
          </Link>
        ) : null}
        {step < STEPS ? (
          <Link href={at(step + 1)} className="min-h-11 py-2 text-base font-semibold text-muted hover:underline">
            {t("ld.wiz.skip")}
          </Link>
        ) : null}
        <span className={`${mutedText} !mt-0`}>{t("ld.wiz.skip.help")}</span>
      </nav>
    </div>
  );
}
