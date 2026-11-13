/** Class strings the design-system-v6 pages share (Leads, Campaigns, Reports, Billing...): one card, one panel, one chip. Colours are the tokens only. */
export const card = "rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5";
export const cardQuiet = "rounded-2xl border border-line bg-surface-2 p-4";
export const sectionTitle = "font-display text-xl font-semibold";
export const chipBase = "inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-semibold";
export const chipOn = `${chipBase} border-brand-edge bg-brand-bg text-brand-text`;
export const chipOff = `${chipBase} border-line bg-surface text-muted hover:bg-surface-2`;
/** The page with a main part and a panel on the right: stacked on a phone, side by side from 1024 px. */
export const withPanel = "mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]";
