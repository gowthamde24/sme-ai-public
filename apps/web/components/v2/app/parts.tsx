import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { alertBox, backLink, link, mutedText, noteBox, okBox, pageH1, pageMain, pillAmber, pillBrand, pillGreen, pillInfo, pillNeutral, pillRed, surface, tabsBar, tabsItem, tabsItemIdle, tabsItemOn } from "./ui";

/**
 * The shared v2 pieces of the app screens (workspace redesign, Batch 1A). They are forks of the pieces the old screens draw by hand
 * (ApiDown, NotShown, Notice, ActionResult): the SAME words, the new look. Nothing here reads data or decides access.
 * A migrated screen wraps its content in <V2Root> (its folder layout) and then uses these.
 */
export function ApiDownV2() {
  return (
    <main className={pageMain}>
      <p role="alert" className={alertBox}>
        Could not load this from the API. Try again shortly.
      </p>
      <p className="mt-4">
        <Link href="/app" className={link}>
          Back to your workspaces
        </Link>
      </p>
    </main>
  );
}

/** "This screen is not shown to your role": the way back, the title and one closed sentence. */
export function NotShownV2({ tenantId, tenantName, title, message }: { tenantId: string; tenantName: string; title: string; message: string }) {
  return (
    <main className={pageMain}>
      <p>
        <Link href={`/app/tenants/${tenantId}`} className={backLink}>
          ← {tenantName}
        </Link>
      </p>
      <h1 className={pageH1}>{title}</h1>
      <p className={mutedText}>{message}</p>
    </main>
  );
}

/** A closed sentence of ours that every screen of a kind shows (for example "nothing is sent"). */
export function NoticeV2({ children }: { children: ReactNode }) {
  return (
    <p role="note" className={noteBox}>
      {children}
    </p>
  );
}

export type ActionResultState = { error?: string; ok?: boolean; message?: string } | undefined;

/** The outcome of a form: our own short sentence (never text from the API or the customer). */
export function ActionResultV2({ state }: { state: ActionResultState }) {
  if (state?.error)
    return (
      <p role="alert" className={alertBox}>
        {state.error}
      </p>
    );
  if (state?.ok && state.message)
    return (
      <p role="status" className={okBox}>
        {state.message}
      </p>
    );
  return null;
}

/** Back link, h1 and (optionally) the role line of a page. The role line stays until the clean-up batch (tests pin it). */
export function PageHeader({ back, title, role, children }: { back?: { href: string; label: string }; title: string; role?: string; children?: ReactNode }) {
  return (
    <header>
      {back ? (
        <p>
          <Link href={back.href} className={backLink}>
            ← {back.label}
          </Link>
        </p>
      ) : null}
      <h1 className={pageH1}>{title}</h1>
      {role ? (
        <p className={mutedText}>
          Your role: <strong>{role}</strong>
        </p>
      ) : null}
      {children}
    </header>
  );
}

export function Panel({ children, labelledBy }: { children: ReactNode; labelledBy?: string }) {
  return (
    <section aria-labelledby={labelledBy} className={`mt-6 ${surface}`}>
      {children}
    </section>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "green" | "amber" | "red" | "info"; children: ReactNode }) {
  return <span className={TONES[tone]}>{children}</span>;
}
const TONES = { neutral: pillNeutral, brand: pillBrand, green: pillGreen, amber: pillAmber, red: pillRed, info: pillInfo } as const;

/**
 * The parts of a long screen, one at a time (Job X: no long single-page scroll): real links to the same page with `?section=`, the current one marked with
 * aria-current. It only draws the switcher; the page decides which part to draw and checks that the part is allowed for the role.
 */
export function SectionTabs({ label, items }: { label: string; items: readonly { key: string; label: string; href: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className={tabsBar}>
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.current ? "page" : undefined} className={`${tabsItem} ${i.current ? tabsItemOn : tabsItemIdle}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The top of a screen as the design-lab app draws it: the title and one calm line on the left, the ONE main action on the right (a link or an add button), then room for what follows.
 * `action` is optional: a screen with no main action draws the title and the line only.
 */
export function PageTop({ title, sub, action, id }: { title: string; sub?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-3xl">
        <h1 id={id} className={`${pageH1} mt-0`}>
          {title}
        </h1>
        {sub ? <p className="text-base text-muted">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/** A segmented control made of real links (a filter or a part of a screen): the current one is the dark chip. */
export function SegmentLinks({ label, items }: { label: string; items: readonly { key: string; label: string; href: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="mt-6 inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-edge bg-surface p-1">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.current ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold ${i.current ? "bg-charcoal text-on-charcoal" : "text-ink hover:bg-surface-2"}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** A figure with its label in a small card (the order's total, received, balance, money held). `amber` = money still held: the one that must be seen. */
export function StatBox({ label, value, amber = false }: { label: string; value: ReactNode; amber?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 shadow-[var(--v2-shadow)] ${amber ? "border-amber-text bg-amber-bg" : "border-line bg-surface"}`}>
      <p className={`text-sm ${amber ? "font-semibold text-amber-text" : "text-muted"}`}>{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

type Where = { tenantId: string; role: string };
/** The parts of "Leads": the review queue, all the leads, the follow-ups due and the assistant's suggestions. Real links to four pages; each page draws this row and marks its own. The follow-ups are for owner, admin and sales. */
export function LeadsTabs({ tenantId, role, current }: Where & { current: "review" | "all" | "followups" | "suggestions" }) {
  const base = `/app/tenants/${tenantId}`;
  const items = [
    { key: "review", label: "To look at", href: `${base}/review` },
    { key: "all", label: "All leads", href: `${base}?tab=leads` },
    ...(role === "viewer" ? [] : [{ key: "followups", label: "Follow-ups due", href: `${base}/followups` }]),
    { key: "suggestions", label: "Suggestions", href: `${base}/suggestions` },
  ];
  return <SectionTabs label="Parts of Leads" items={items.map((i) => ({ ...i, current: i.key === current }))} />;
}

/** The parts of "Catalogue and prices": item types, the price list, adding a product and the quote policy (the last three for owner and admin). */
export function CatalogueTabs({ tenantId, role, current }: Where & { current: "item-types" | "price-list" | "add-product" | "quote-policy" }) {
  const base = `/app/tenants/${tenantId}`;
  const admin = role === "owner" || role === "admin";
  const items = [
    { key: "item-types", label: "Item types", href: `${base}/item-types` },
    ...(admin
      ? [
          { key: "price-list", label: "Price list", href: `${base}/price-list` },
          { key: "add-product", label: "Add a product", href: `${base}/products/new` },
          { key: "quote-policy", label: "Quote policy", href: `${base}/quote-policy` },
        ]
      : []),
  ];
  return <SectionTabs label="Parts of Catalogue and prices" items={items.map((i) => ({ ...i, current: i.key === current }))} />;
}

/**
 * The way back on a detail page (an order, a quote or enquiry, a lead, a customer), as the design-lab app draws it: an arrow and the name of the list ("All orders"), at the top left of the page,
 * at every width. It replaces the frame's breadcrumb line. `then` is an optional second link of the same kind (the enquiry's lead).
 */
export function BackLink({ href, label, then }: { href: string; label: string; then?: { href: string; label: string } }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4">
      <Link href={href} className={`${backLink} gap-2`}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        {label}
      </Link>
      {then ? (
        <Link href={then.href} className={link}>
          {then.label}
        </Link>
      ) : null}
    </p>
  );
}
