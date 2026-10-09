import { btnPrimary } from "@/components/v2/landing/ui";

/**
 * Class strings of the app screens in the v2 look (workspace redesign). Pages and forms take their classes from here, so Tailwind sees every class
 * (it scans components/v2) and a page file changes class names only. No legacy class name (`shell`, `card`, `hint`, `error`, `row`, `tap`, `badge` ...)
 * may appear in a v2 file: the source check of audit:leaks enforces it.
 */
/** The page's own <main>. */
export const pageMain = "mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8";
export const pageMainNarrow = "mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8";
export const pageH1 = "mb-2 font-display text-3xl font-bold leading-tight sm:text-4xl";
export const pageH2 = "mb-3 mt-8 font-display text-2xl font-bold leading-tight";
export const pageH3 = "mb-2 mt-5 font-display text-xl font-bold leading-tight";
export const bodyText = "mt-3 text-base";
export const mutedText = "mt-2 text-sm text-muted";
export const backLink = "inline-flex min-h-11 items-center gap-1 rounded-lg text-base font-semibold text-brand-text hover:underline";
export const link = "inline-flex min-h-11 items-center rounded-lg text-base font-semibold text-brand-text hover:underline";
export const inlineLink = "font-semibold text-brand-text underline underline-offset-2 hover:no-underline";
export const surface = "rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5";
export const surfaceFlat = "rounded-xl border border-line bg-surface p-4 sm:p-5";
export const noteBox = "mt-4 rounded-lg border border-line bg-info-bg p-3 text-sm font-medium text-info-text";
export const warnBox = "mt-4 rounded-lg border border-amber-text bg-amber-bg p-3 text-sm font-medium text-amber-text";
export const alertBox = "mt-4 rounded-lg border border-red-text bg-red-bg p-3 font-medium text-red-text";
export const okBox = "mt-4 rounded-lg border border-green-text bg-green-bg p-3 font-medium text-green-text";
export const formStack = "flex flex-col gap-4";
export const fieldLabel = "mb-1.5 block text-sm font-semibold";
export const fieldInput = "min-h-12 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge";
export const fieldTextarea = `${fieldInput} py-2`;
export const fieldHelp = "mt-1.5 text-sm text-muted";
export const checkRow = "flex min-h-11 items-center gap-3 text-base";
export const checkBox = "size-6 shrink-0 accent-brand-text";
export const btnMain = `${btnPrimary} disabled:opacity-60`;
export const btnQuiet =
  "inline-flex min-h-12 items-center justify-center rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";
export const btnDanger =
  "inline-flex min-h-12 items-center justify-center rounded-lg border border-red-text bg-red-bg px-4 text-base font-semibold text-red-text hover:brightness-95 disabled:opacity-60";
export const btnRow = "mt-4 flex flex-wrap items-center gap-3";
export const stickyActions = "sticky bottom-20 z-10 mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 md:bottom-4";
export const pill = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold";
export const pillNeutral = `${pill} border-line bg-surface-2 text-muted`;
export const pillBrand = `${pill} border-brand-edge bg-brand-bg text-brand-text`;
export const pillGreen = `${pill} border-green-text bg-green-bg text-green-text`;
export const pillAmber = `${pill} border-amber-text bg-amber-bg text-amber-text`;
export const pillRed = `${pill} border-red-text bg-red-bg text-red-text`;
export const pillInfo = `${pill} border-info-text bg-info-bg text-info-text`;
export const tableWrap = "mt-3 overflow-x-auto rounded-xl border border-line bg-surface";
export const table = "w-full border-collapse text-left text-base";
export const th = "border-b border-line bg-surface-2 px-3 py-2 text-sm font-semibold";
export const td = "border-b border-line px-3 py-2 align-top";
export const kvList = "mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-base";
export const kvTerm = "text-sm font-semibold text-muted";
export const kvValue = "min-w-0 break-words";
export const plainText = "whitespace-pre-wrap [overflow-wrap:anywhere]";
export const listPlain = "mt-3 flex flex-col gap-3";
export const listItemCard = "rounded-xl border border-line bg-surface p-4";
export const tabRow = "mt-4 flex flex-wrap gap-2 border-b border-line pb-3";
export const tabLink = "inline-flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-ink hover:bg-surface-2";
export const tabLinkOn = "bg-brand-bg font-semibold text-brand-text";
/** A small grey line under a list entry. */
export const metaLine = "mt-1 block text-sm text-muted";
/** A bold sentence on its own line inside a list entry. */
export const emphasisLine = "mt-2 block font-semibold";
export const spaceTop = "mt-4";
export const formCard = "mt-4 flex max-w-xl flex-col gap-3 rounded-xl border border-line bg-surface p-4";
export const formTitle = "font-display text-lg font-bold";
export const eventItem = "rounded-xl border border-line bg-surface p-4";
export const listOrdered = "mt-3 flex flex-col gap-3";
export const leadLine = "mt-1 text-lg";
