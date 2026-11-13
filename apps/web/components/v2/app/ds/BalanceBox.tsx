"use client";

import Link from "next/link";

import { word, type Labels } from "../labels";

/**
 * The one money box of the side menu and of the phone's More sheet (design system v6, owner 13 Nov 2026): the rupee balance and what it buys ("₹1,550 · about 310 call minutes") with Top up (owner, 13 Nov 2026: nothing else in the box; search lives in the top bar, the person in the avatar menu). It replaces the old "Call minutes 0/30" and "AI usage ₹35/₹300" meters. Never the word
 * "credits". With no balance known it says nothing about money (the links stay).
 */
export function BalanceBox({ balance, tenantId, labels, onNavigate }: { balance: { text: string; low: boolean; minutes: number | null } | null; tenantId: string; labels?: Labels; onNavigate?: () => void }) {
  const base = `/app/tenants/${tenantId}`;
  return (
    <div data-part="balance-box" className="flex items-center justify-between gap-3 px-3 py-2.5">
      {balance ? (
        <p className="min-w-0 text-sm leading-snug">
          <span data-part="balance-amount" className={`block text-base font-semibold tabular-nums ${balance.low ? "text-red-text" : "text-ink"}`}>
            {balance.text}
          </span>
          {balance.minutes !== null ? <span className="block text-xs text-muted">{word(labels, "frame.balance.minutes", "about {n} call minutes", { n: balance.minutes })}</span> : null}
        </p>
      ) : (
        <span />
      )}
      <Link href={`${base}/billing`} onClick={onNavigate} className="shrink-0 text-sm font-semibold text-brand-text underline-offset-2 hover:underline">
        {word(labels, "nav.link.topup", "Top up")}
      </Link>
    </div>
  );
}
