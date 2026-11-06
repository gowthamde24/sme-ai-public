"use client";

import Link from "next/link";
import * as React from "react";
import { createPortal } from "react-dom";

import { markHref, type AiTeamPanel, type Helper } from "@/lib/api/ai-team";

import { LANE_TONE, clockOf, duration, fill, rupees, statusWords } from "./shift";

export type SwitchFn = (helper: Helper, enabled: boolean) => Promise<{ ok: true; enabled: boolean } | { ok: false; error: "mfa" | "forbidden" | "signin" | "failed" }>;

/**
 * One helper's side panel (click a lane's name): what it does now and its last 10 actions, today's numbers and success rate, the day's cost, its rules (links to their screens), the on/off switch (Owner or Admin with the second
 * factor; off = it does nothing on its own and what it would have done waits) and "Train it". A drawer on the right of a desktop, the whole screen on a phone; Esc closes; focus returns to the lane.
 */
export function HelperPanel({ base, helper, name, words, manages, onSwitch, mfaHref, onClose, onChanged }: { tenantId: string; base: string; helper: Helper; name: string; words: Readonly<Record<string, string>>; manages: boolean; onSwitch: SwitchFn | null; mfaHref: string; onClose: () => void; onChanged: () => void }) {
  const w = (k: string, vars?: Record<string, string>) => fill(words[k] ?? k, vars);
  const [panel, setPanel] = React.useState<AiTeamPanel | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [swError, setSwError] = React.useState<"mfa" | "failed" | null>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  // when the panel opened: a running call's time is counted from it (the lane itself keeps the live timer)
  const [openedAt] = React.useState(() => Date.now());

  React.useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => opener.current?.focus?.();
  }, []);
  React.useEffect(() => {
    const ctl = new AbortController();
    fetch(`${base}/ai-team/panel?${new URLSearchParams({ helper }).toString()}`, { credentials: "same-origin", cache: "no-store", signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        // our own route already read the API strictly (parsePanel): its answer is the parsed panel
        const next = ((await r.json()) as { panel: AiTeamPanel }).panel;
        if (!next || !Array.isArray(next.recent)) throw new Error("panel");
        setPanel(next);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setFailed(true);
      });
    return () => ctl.abort();
  }, [base, helper]);

  const flip = async () => {
    if (!panel || !onSwitch || saving) return;
    setSaving(true);
    setSwError(null);
    const r = await onSwitch(helper, !panel.enabled);
    setSaving(false);
    if (r.ok) {
      setPanel({ ...panel, enabled: r.enabled, statusNow: r.enabled ? panel.statusNow : { kind: "paused", textKey: "paused", count: panel.statusNow?.count ?? null, at: null, who: null, since: new Date().toISOString() } });
      onChanged();
    } else setSwError(r.error === "mfa" ? "mfa" : "failed");
  };
  const s = panel ? statusWords(panel.statusNow, panel.statusNow?.since ? Math.round((openedAt - Date.parse(panel.statusNow.since)) / 1000) : null) : null;
  const tone = LANE_TONE[helper];

  return createPortal(
    <div className="fixed inset-0 z-[62]" data-helper-panel={helper} onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), onClose())}>
      <div aria-hidden="true" className="absolute inset-0 bg-charcoal/30" onClick={onClose} />
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="helper-panel-title" className="absolute inset-0 flex flex-col overflow-hidden border-line bg-bg outline-none md:inset-y-0 md:left-auto md:right-0 md:w-[28rem] md:border-l md:shadow-[var(--v2-shadow-pop)]">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span aria-hidden="true" className={`size-3 rounded-full ${panel && !panel.enabled ? "bg-muted" : tone.dot}`} />
          <h2 id="helper-panel-title" className="min-w-0 flex-1 font-display text-xl font-bold">
            {name}
          </h2>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-muted hover:bg-surface-2">
            {w("aiteam.panel.close")}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {failed ? <p className="rounded-lg border border-red-text bg-red-bg p-3 text-red-text">{w("aiteam.panel.failed")}</p> : null}
          {!panel && !failed ? <p className="text-muted">{w("aiteam.panel.loading")}</p> : null}
          {panel ? (
            <div className="flex flex-col gap-5">
              {s ? <p className={`text-base font-semibold ${panel.statusNow?.kind === "waiting" ? "text-brand-text" : panel.statusNow?.kind === "busy" ? "text-green-text" : "text-ink"}`}>{(panel.statusNow?.kind === "busy" ? "● " : "") + w(s.key, s.vars)}</p> : null}

              {/* the switch: the Owner or an Admin (with the second factor); others see why not */}
              <div className="rounded-xl border border-line bg-surface p-3" data-part="switch">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-base font-semibold">{w("aiteam.panel.switch")}</span>
                  {panel.canSwitch && manages && onSwitch ? (
                    <button type="button" role="switch" aria-checked={panel.enabled} disabled={saving} onClick={() => void flip()} aria-label={`${w("aiteam.panel.switch")}: ${name}`} className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 ${panel.enabled ? "border-brand-edge bg-brand" : "border-edge bg-surface-2"}`}>
                      <span aria-hidden="true" className={`inline-block size-6 rounded-full bg-white shadow transition-transform ${panel.enabled ? "translate-x-7" : "translate-x-1"}`} />
                    </button>
                  ) : (
                    <span className="text-sm font-semibold text-muted">{panel.enabled ? w("aiteam.panel.on") : w("aiteam.panel.off")}</span>
                  )}
                </div>
                {!panel.enabled ? <p className="mt-2 text-sm text-muted">{w("aiteam.panel.off.note")}</p> : null}
                {!panel.canSwitch || !manages ? <p className="mt-2 text-sm text-muted">{w("aiteam.panel.locked")}</p> : null}
                {swError === "mfa" ? (
                  <p className="mt-2 text-sm text-amber-text">
                    {w("aiteam.panel.mfa")}{" "}
                    <Link href={mfaHref} className="font-semibold underline underline-offset-2">
                      {w("aiteam.panel.mfa.link")}
                    </Link>
                  </p>
                ) : swError ? (
                  <p role="alert" className="mt-2 text-sm text-red-text">
                    {w("aiteam.panel.swfail")}
                  </p>
                ) : null}
              </div>

              <section aria-labelledby="hp-numbers">
                <h3 id="hp-numbers" className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                  {w("aiteam.panel.numbers")}
                </h3>
                <dl className="grid grid-cols-3 gap-2" data-part="numbers">
                  {panel.today.numbers.map((n) => (
                    <div key={n.key} className={`rounded-lg bg-surface-2 p-2 ${n.bySource ? "col-span-3" : ""}`}>
                      <dt className="text-xs text-muted">{w(`aiteam.num.${n.key}`)}</dt>
                      <dd className="font-display text-lg font-bold">
                        {n.bySource ? n.bySource.map((b) => `${w(`aiteam.src.${b.source}`)} ${b.count}`).join(" · ") : n.value === null ? "–" : n.key === "value_paise" ? rupees(n.value) : n.key.endsWith("_percent") ? `${n.value}%` : n.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {panel.costToday?.paise != null ? (
                  <p className="mt-2 text-sm text-muted" data-part="cost">
                    {w("aiteam.panel.cost")}: <span className="font-semibold text-ink">{rupees(panel.costToday.paise)}</span>
                  </p>
                ) : null}
              </section>

              <section aria-labelledby="hp-recent">
                <h3 id="hp-recent" className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                  {w("aiteam.panel.recent")}
                </h3>
                {panel.recent.length === 0 ? <p className="text-muted">{w("aiteam.panel.none")}</p> : null}
                <ul className="flex flex-col">
                  {panel.recent.map((m) => {
                    const href = markHref(base, m.ref);
                    const inner = (
                      <>
                        <span className="w-12 shrink-0 text-sm tabular-nums text-muted">{clockOf(m.t)}</span>
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{m.label}</span>
                        {m.seconds ? <span className="text-sm text-muted">{duration(m.seconds)}</span> : null}
                        {m.needsOwner ? <span className="rounded-full bg-brand px-2 text-xs font-bold text-white">⚑</span> : null}
                      </>
                    );
                    return (
                      <li key={m.id} className="border-t border-line first:border-t-0">
                        {href ? (
                          <Link href={href} className="flex min-h-11 items-center gap-2 rounded-lg py-1 hover:bg-surface-2">
                            {inner}
                          </Link>
                        ) : (
                          <div className="flex min-h-11 items-center gap-2 py-1">{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              {panel.settings.length ? (
                <section aria-labelledby="hp-rules">
                  <h3 id="hp-rules" className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                    {w("aiteam.panel.rules")}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {panel.settings.map((st) => {
                      const href = st.href.startsWith(`${base}/`) ? st.href : null;
                      const label = words[`aiteam.set.${st.key}`] ?? w("aiteam.set.other");
                      return (
                        <li key={st.key}>
                          {href ? (
                            <Link href={href} className="inline-flex min-h-11 items-center gap-2 font-semibold text-brand-text hover:underline">
                              {label}
                              {st.value ? <span className="font-normal text-muted">· {st.value}</span> : null}
                            </Link>
                          ) : (
                            <span>{label}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              <Link href={`${base}/ai-team/training`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-brand-edge px-4 font-semibold text-brand-text hover:bg-brand-bg" data-part="train">
                {w("aiteam.panel.train")}
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    // inside the app's own root (its theme, fonts and styles live there), not the bare body
    document.querySelector('[data-ui="v2"]') ?? document.body,
  );
}
