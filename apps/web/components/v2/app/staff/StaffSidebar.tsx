import Link from "next/link";

import { NAV, ROLE_BADGE, TEXT, type NavKey } from "@/lib/staff/words";
import { count } from "@/lib/staff/format";
import type { Overview, StaffMe } from "@/lib/staff/types";

import { StaffIcon } from "./StaffIcon";

/** The initials of a name: "Gowtham" -> "G", "Anu S." -> "AS". */
export function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 1)).toUpperCase();
}

/**
 * The dark side menu of the staff console: the product mark with the "Staff console" tag, the eight areas (only Overview exists yet: the others are drawn quiet and are not links, so nothing leads to a page that is not there), the badge counts from the API (a zero is not
 * drawn), and who is signed in: name, "2FA on" and the role badge. A server component: no script.
 */
export function StaffSidebar({ me, overview, keep, active }: { me: StaffMe; overview: Overview; keep: string; active: NavKey }) {
  const b = overview.badges;
  const badge: Partial<Record<NavKey, { n: number; tone: "n" | "w" | "plain" }>> = {
    businesses: { n: b.businesses, tone: "plain" },
    support: { n: b.supportOpen, tone: "n" },
    health: { n: b.healthIssues, tone: "w" },
    compliance: { n: b.complianceOpen, tone: "n" },
  };
  return (
    <aside className="sc-side" aria-label="Staff console">
      <div className="sc-logo">
        <svg width="22" height="22" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <rect x="14" y="14" width="46" height="18" rx="9" />
          <rect x="14" y="39" width="68" height="18" rx="9" />
          <rect x="36" y="64" width="46" height="18" rx="9" />
        </svg>
        {TEXT.brand}
      </div>
      <div className="sc-tag">
        <i aria-hidden="true" />
        {TEXT.tag}
      </div>
      <nav className="sc-nav" aria-label="Staff areas">
        {NAV.map((item) => {
          const shown = badge[item.key];
          const mark = shown && shown.n > 0 ? shown.tone === "plain" ? <em>{count(shown.n)}</em> : <em><b className={shown.tone}>{count(shown.n)}</b></em> : null;
          const inner = (
            <>
              <StaffIcon name={item.key} />
              <span>{item.label}</span>
              {mark}
            </>
          );
          return "href" in item ? (
            <Link key={item.key} href={`${item.href}${keep}`} aria-current={active === item.key ? "page" : undefined}>
              {inner}
            </Link>
          ) : (
            <span key={item.key} className="sc-item sc-soon" title="Not built yet">
              {inner}
            </span>
          );
        })}
      </nav>
      <div className="sc-me">
        <span className="sc-av" aria-hidden="true">{initialsOf(me.name)}</span>
        <div>
          <b>{me.name}</b>
          <small>{me.secondFactor ? "2FA on" : "2FA off"}</small>
        </div>
        <span className="sc-role">{ROLE_BADGE[overview.role] ?? overview.role.toUpperCase()}</span>
      </div>
    </aside>
  );
}
