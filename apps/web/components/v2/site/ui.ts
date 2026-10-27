/** Class strings of the public site's own parts (job CM); the shared ones (container, h2, card, control, btnPrimary) are components/v2/landing/ui.ts. Plain constants so Tailwind sees every class. */
export { btnPrimary, card, container, control, h2, lead } from "@/components/v2/landing/ui";
export const section = "py-12 sm:py-16";
export const eyebrow = "text-sm font-semibold text-brand-text sm:text-base";
export const btnSecondary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-edge bg-surface px-5 text-base font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2 active:bg-line";
export const linkQuiet = "inline-flex min-h-11 items-center rounded-lg px-2 text-base font-semibold text-brand-text hover:underline";
export const chip = "inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-sm font-medium text-ink";

// The home page of night 5 (landing v3): Bricolage Grotesque at its normal width, weight 800, -0.025em, in the sizes the owner chose (a phone to a laptop); body 17 px (16 px on a phone). `length:` tells Tailwind these are sizes, not colours.
export const h1Home = "font-display font-extrabold leading-[1.04] tracking-[-0.025em] [text-wrap:balance] text-[length:clamp(40px,calc(4vw_+_8px),64px)]";
export const h2Home = "font-display font-extrabold leading-[1.06] tracking-[-0.025em] [text-wrap:balance] text-[length:clamp(32px,calc(2.6vw_+_14px),52px)]";
export const h3Row = "font-display font-extrabold leading-[1.12] tracking-[-0.025em] text-[length:clamp(24px,calc(1.4vw_+_12px),32px)]";
export const h3Industry = "font-display font-extrabold leading-[1.1] tracking-[-0.025em] text-[length:clamp(26px,calc(1.6vw_+_12px),34px)]";
export const pillHome = "rounded-full border border-line bg-surface px-3.5 py-2 text-[14.5px] font-medium";
export const wrapHome = "mx-auto w-full max-w-[1200px] px-[18px] sm:px-6";
