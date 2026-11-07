"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { LowStockItem } from "@/lib/api/catalogue";

import { alertBox, btnMain, btnQuiet, fieldInput, okBox } from "../ui";
import { makeT, type Words } from "../words";

export type StockCountFn = (itemId: string, quantity: number | null) => Promise<{ ok: true; quantity: number | null } | { ok: false; error: string }>;

/**
 * Low stock in the catalogue (app v4 part 6, owner 7 Nov 2026): "Red Kanchi silk: 2 left, about 3 asked this week". Each row is a saree that is low (3 or fewer when a count is kept, else marked "few left"), with how many customers
 * asked for something with its name in the last 7 days (approximate, so "about"). The Owner and an Admin can set the count right there, or stop counting; the count only says "left" when someone set it, otherwise the row says "Few left".
 * Nothing is worked out here: every number is the API's.
 */
export function LowStock({ items, canCount, base, count, words, countsAvailable }: { items: readonly LowStockItem[]; canCount: boolean; base: string; count: StockCountFn; words?: Words; countsAvailable: boolean }) {
  const t = makeT(words);
  const router = useRouter();
  const [open, setOpen] = React.useState<string | null>(null);
  const [value, setValue] = React.useState("");
  const [busy, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  if (items.length === 0) return null;
  const save = (id: string, q: number | null) =>
    start(async () => {
      const out = await count(id, q);
      if (!out.ok) return setMsg({ ok: false, text: t(`ls.err.${out.error}` as "ls.err.down") });
      setMsg({ ok: true, text: t("ls.saved") });
      setOpen(null);
      router.refresh();
    });
  const asked = (i: LowStockItem) => (i.askedThisWeek > 0 ? t(i.askedIsApproximate ? "ls.asked.about" : "ls.asked", { n: i.askedThisWeek }) : null);
  return (
    <section aria-labelledby="ls-title" className="flex flex-col gap-3 rounded-[22px] border border-line bg-surface p-4" data-part="low-stock">
      <h2 id="ls-title" className="m-0 font-display text-lg font-bold">
        {t("ls.title")}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((i) => (
          <li key={i.id} data-item={i.id} className="flex flex-col gap-1.5 border-b border-line pb-2 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <Link href={`${base}/catalogue/${i.id}`} className="font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]">
                {i.name}
              </Link>
              <span className="text-sm font-bold text-brand-text" data-part="left">
                {i.quantity !== null ? t("ls.left", { n: i.quantity }) : t("ls.few")}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-sm text-muted">{asked(i) ?? "\u00a0"}</span>
              {canCount && countsAvailable ? (
                <button type="button" className={`${btnQuiet} !min-h-9`} onClick={() => (setOpen(open === i.id ? null : i.id), setValue(i.quantity === null ? "" : String(i.quantity)), setMsg(null))} aria-expanded={open === i.id}>
                  {t("ls.set")}
                </button>
              ) : null}
            </div>
            {open === i.id ? (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!/^\d{1,7}$/.test(value.trim())) return setMsg({ ok: false, text: t("ls.err.invalid") });
                  save(i.id, Number(value.trim()));
                }}
              >
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  {t("ls.how_many")}
                  <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className={`${fieldInput} w-28`} maxLength={7} />
                </label>
                <button type="submit" disabled={busy} className={btnMain}>
                  {busy ? t("ls.saving") : t("ls.save")}
                </button>
                {i.quantity !== null ? (
                  <button type="button" disabled={busy} className={btnQuiet} onClick={() => save(i.id, null)}>
                    {t("ls.stop")}
                  </button>
                ) : null}
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? okBox : alertBox}>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
