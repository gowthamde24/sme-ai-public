"use client";

import type { InputHTMLAttributes, ReactNode } from "react";

import { jbCard, jbHeading } from "./simple-b-styles";

/**
 * The few parts the Settings cards of group B share under JOBS (Your assistant, Quotes, Developer keys, Privacy and data): the card, its heading and a text or date typed INSIDE a sentence, drawn as the same pill as a choice
 * (Sentence, Choose, PillNum, EffectBox and MoreChoices come from jobs/rules/parts.tsx, the finished Rules pass). Nothing here animates.
 */
const pill = "write-ctl mx-0.5 my-0.5 min-h-10 max-w-full rounded-md border border-[color:var(--v2-pill-edge)] bg-brand-bg px-3.5 text-[16px] font-semibold text-brand-text placeholder:font-normal placeholder:text-muted disabled:opacity-80";

/** A word or a date typed inside a sentence, as a pill (a number has `PillNum` in parts.tsx). The real native input: the keyboard, the screen reader and the phone's own date picker work as always. */
export function PillField({ aria, width = "w-44", ...input }: { aria: string; width?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "aria-label" | "className">) {
  return <input aria-label={aria} {...input} className={`${pill} ${width} align-middle`} />;
}

/** A card with a heading: the part of a Settings page under JOBS. */
export function JbCard({ id, title, part, children }: { id: string; title: string; part: string; children: ReactNode }) {
  return (
    <section data-part={part} aria-labelledby={id} className={jbCard}>
      <h3 id={id} className={jbHeading}>
        {title}
      </h3>
      {children}
    </section>
  );
}
