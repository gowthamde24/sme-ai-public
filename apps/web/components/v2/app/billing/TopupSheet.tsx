"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { btnMain, btnQuiet } from "../ui";
import { makeT, type Words } from "../words";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Add money (design system v6): a sheet with four amounts and one Pay button, clearly marked TEST while the payment is Razorpay's test mode (or the page's own test state): no real money moves. Pay is the page's server action; the page then reads again. With no top-up yet
 * (`available` false) the sheet says it opens with online payment soon and the Pay button is off. Money in ₹, never "credits".
 */
export function TopupSheet({ words, amounts, available, gstText, pay }: { words: Words; amounts: ReadonlyArray<{ paise: number; text: string }>; available: boolean; gstText: string | null; pay: (paise: number) => Promise<Result> }) {
  const t = makeT(words);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [paise, setPaise] = React.useState<number | null>(amounts[1]?.paise ?? amounts[0]?.paise ?? null);
  const [busy, start] = React.useTransition();
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const first = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const go = () =>
    start(async () => {
      if (paise === null) return;
      setNote(null);
      const out = await pay(paise).catch((): Result => ({ ok: false, error: t("bv6.err.generic") }));
      if (out.ok) {
        setNote({ ok: true, text: t("bv6.topup.done") });
        router.refresh();
      } else setNote({ ok: false, text: out.error });
    });
  return (
    <>
      <button type="button" onClick={() => { setNote(null); setOpen(true); }} className={btnMain} data-part="topup-open">
        {t("bv6.topup.open")}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="bv6-topup-h" data-part="topup-sheet" className="w-full max-w-md rounded-t-2xl border border-line bg-surface p-5 shadow-[var(--v2-shadow-pop)] sm:rounded-2xl">
            <h2 id="bv6-topup-h" className="font-display text-xl font-semibold">
              {t("bv6.topup.title")}
            </h2>
            <p className="mt-1 rounded-lg bg-brand-bg px-3 py-2 text-sm font-semibold text-brand-text" data-part="test-banner">
              {t("bv6.test")}
            </p>
            {available ? (
              <>
                <div role="radiogroup" aria-label={t("bv6.topup.pick")} className="mt-4 grid grid-cols-2 gap-2">
                  {amounts.map((a, i) => (
                    <button key={a.paise} ref={i === 0 ? first : undefined} type="button" role="radio" aria-checked={paise === a.paise} onClick={() => setPaise(a.paise)} className={`min-h-12 rounded-xl border px-3 text-lg font-semibold ${paise === a.paise ? "border-brand-edge bg-brand-bg text-brand-text" : "border-line bg-surface text-ink hover:bg-surface-2"}`}>
                      {a.text}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted">{gstText ? `${t("bv6.topup.gst")} ${gstText}` : t("bv6.topup.gst")}</p>
              </>
            ) : (
              <p className="mt-4 text-base text-muted">{t("bv6.topup.na")}</p>
            )}
            {note ? (
              <p role={note.ok ? "status" : "alert"} className={`mt-3 text-sm font-semibold ${note.ok ? "text-green-text" : "text-red-text"}`}>
                {note.text}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className={btnQuiet}>
                {t("bv6.topup.close")}
              </button>
              {available ? (
                <button type="button" disabled={busy || paise === null} onClick={go} className={btnMain}>
                  {t("bv6.topup.pay")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
