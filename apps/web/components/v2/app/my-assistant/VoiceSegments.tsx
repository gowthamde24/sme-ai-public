"use client";

import * as React from "react";

import { makeT, type Words } from "../words";

export const SEGMENTS = ["tone", "words", "region", "address"] as const;
export type Segment = (typeof SEGMENTS)[number];

/**
 * The segmented control over "How your assistant speaks": Tone · Words · Region · Addresses (owner, 13 Nov 2026). It does not rebuild the panel: it shows ONE of its four parts at a time (the others are hidden by design/ds.css, `[data-seg]`), over the
 * panel that already saves them, so the choices, the "Hear an example" buttons and the Save button are the working ones. Addresses are garu, sir or madam, by name (and ji in Hindi). The first part is Tone.
 */
export function VoiceSegments({ words, children }: { words?: Words; children: React.ReactNode }) {
  const t = makeT(words);
  const [seg, setSeg] = React.useState<Segment>("tone");
  return (
    <section data-part="mya-segments" className="flex flex-col gap-3">
      <div role="group" aria-label={t("mya.v.seg.label")} className="inline-flex max-w-full flex-wrap self-start rounded-full border border-edge bg-surface-2/60 p-1">
        {SEGMENTS.map((s) => (
          <button key={s} type="button" aria-pressed={s === seg} data-seg-button={s} onClick={() => setSeg(s)} className={`min-h-11 rounded-full px-4 text-sm font-semibold ${s === seg ? "bg-brand text-on-brand" : "text-muted hover:text-ink"}`}>
            {t(`mya.v.seg.${s}` as "mya.v.seg.tone")}
          </button>
        ))}
      </div>
      <div data-seg={seg}>{children}</div>
    </section>
  );
}
