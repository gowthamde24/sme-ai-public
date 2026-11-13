"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { AssistantState, Missing } from "@/lib/assistant-status/types";

import { btnMain, btnQuiet } from "../ui";
import { makeT, type Words } from "../words";

type Result = { ok: true; state: AssistantState } | { ok: false; error: "missing"; missing: Missing[] } | { ok: false; error: "forbidden" | "not_available" | "down" };
export type GoLiveAct = (what: "go-live" | "pause") => Promise<Result>;

/** Where to fix what is missing: the business name is in Settings > Business, the phone number on the Phone numbers page. */
export const fixHref = (base: string, m: Missing): string => (m === "business_name" ? `${base}/settings?section=business` : `${base}/phone-number`);

/**
 * "Go live" / "Pause", top-right of My assistant (owner, 13 Nov 2026). Only the Owner has it (the others read a line that says so). Only a business name and a connected phone number are needed to go live; when one is missing the button
 * does not call anything: it OPENS a plain list of what is missing, each with the link that fixes it ("the button explains what is missing"). If the API still says not ready (the status was out of date) the same list opens with what the API says is missing.
 */
export function GoLiveButton({ words, state, canGoLive, missing, owner, act, base }: { words?: Words; state: AssistantState; canGoLive: boolean; missing: readonly Missing[]; owner: boolean; act: GoLiveAct; base: string }) {
  const t = makeT(words);
  const router = useRouter();
  const [busy, start] = React.useTransition();
  const uid = React.useId();
  const [open, setOpen] = React.useState(false);
  const [lack, setLack] = React.useState<readonly Missing[]>(missing);
  const [error, setError] = React.useState<"forbidden" | "not_available" | "down" | null>(null);
  const [done, setDone] = React.useState<AssistantState | null>(null);
  if (!owner) {
    return (
      <p data-part="mya-owneronly" className="m-0 max-w-64 text-sm text-muted">
        {t("mya.owneronly")}
      </p>
    );
  }
  const live = state === "live";
  const press = () => {
    setError(null);
    setDone(null);
    if (!live && !canGoLive) {
      setLack(missing);
      setOpen((o) => !o);
      return;
    }
    start(async () => {
      const out = await act(live ? "pause" : "go-live").catch(() => ({ ok: false as const, error: "down" as const }));
      if (out.ok) {
        setOpen(false);
        setDone(out.state);
        router.refresh();
      } else if (out.error === "missing") {
        setLack(out.missing);
        setOpen(true);
      } else setError(out.error);
    });
  };
  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <button type="button" onClick={press} disabled={busy} aria-expanded={!live && !canGoLive ? open : undefined} aria-controls={!live && !canGoLive && open ? uid : undefined} data-part="mya-golive" className={live ? btnQuiet : btnMain}>
        {busy ? t("mya.working") : t(live ? "mya.pause" : "mya.golive")}
      </button>
      {open ? (
        <div id={uid} role="status" data-part="mya-missing" className="w-full max-w-80 rounded-xl border border-brand-edge bg-brand-bg p-3 text-sm md:text-left">
          <p className="m-0 font-semibold">{t("mya.missing.title")}</p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {(lack.length > 0 ? lack : (["business_name", "phone_number"] as const)).map((m) => (
              <li key={m}>
                <Link href={fixHref(base, m)} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline underline-offset-2">
                  {t(`mya.missing.fix.${m}` as "mya.missing.fix.business_name")}
                </Link>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-1 text-muted">{t("mya.missing.only")}</p>
        </div>
      ) : null}
      {done ? (
        <p role="status" data-part="mya-done" className="m-0 text-sm font-semibold text-green-text">
          {t(done === "live" ? "mya.live.done" : "mya.pause.done")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-sm font-medium text-red-text">
          {t(`mya.err.${error}` as "mya.err.down")}
        </p>
      ) : null}
    </div>
  );
}
