import { btnPrimary } from "@/components/v2/landing/ui";

/**
 * Class strings of the sign-in and account screens (Stage 3). The pages and forms take their classes from here, so
 * Tailwind sees every class (it scans components/v2) and the page files change class names only. No legacy class name
 * (`shell`, `card`, `error`, `hint`, `row`, `secondary`) may appear in a v2 file: the source check of audit:leaks and the
 * skin-contract test enforce it.
 */
/** The page's own <main>: it is the card. */
export const authMain = "mx-auto w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-[var(--v2-shadow)] sm:p-8";
export const authH1 = "mb-2 font-display text-3xl font-bold leading-tight sm:text-4xl";
export const authLead = "mb-4 text-base text-muted";
export const authForm = "flex flex-col";
export const authLabel = "mb-1.5 mt-4 block text-sm font-semibold";
export const authField = "min-h-12 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge";
export const authCode = `${authField} text-center font-mono text-2xl tracking-[0.5em]`;
export const authHint = "mt-2 text-sm text-muted";
export const authAlert = "mt-4 rounded-lg border border-red-text bg-red-bg p-3 font-medium text-red-text";
export const authNotice = "mt-4 rounded-lg border border-line bg-info-bg p-3 text-sm font-medium text-info-text";
export const authSubmit = `${btnPrimary} w-full disabled:opacity-60`;
/** The same button directly under the fields (no row around it). */
export const authSubmitSolo = `${authSubmit} mt-6`;
export const authSecondary =
  "mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";
export const authRow = "mt-6 flex flex-col items-center gap-3";
export const authLink = "inline-flex min-h-11 items-center rounded-lg text-base font-semibold text-brand-text hover:underline";
export const authParagraph = "mt-4 text-base";
