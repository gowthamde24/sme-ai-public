"use client";

import * as React from "react";

import { formatRupeesShort } from "@/lib/money";
import { rupeesToPaise } from "@/lib/topups/input";
import { count } from "@/lib/topups/logic";
import type { Pack, SettingsInput, TopupSettings, UpgradePreview } from "@/lib/topups/types";

import { btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, surface } from "../ui";
import { makeT, type Say, type Words } from "../words";
import { SHORT } from "./alert-text";
import { CheckoutSheet, type CheckoutLine } from "./CheckoutSheet";
import type { TopupActions, UpgradeTarget } from "./types";
import { useTopupMove } from "./use-topup-move";

const rupees = (paise: number): string => (paise > 0 ? String(paise / 100) : "");
const packWord = (t: Say, p: Pack): string => t(`tu.pack.${SHORT[p.kind]}`, { n: count(p.units) });
const priceWord = (t: Say, p: Pack): string => t(p.isPlaceholder ? "tu.pack.price.test" : "tu.pack.price", { total: formatRupeesShort(p.totalPaise) });

type Sheet = { id: string; title: string; lines: CheckoutLine[]; payLabel: string; what: string; pay: (id: string, method: string) => Promise<boolean> };

function Switch({ t, id, label, checked, onChange, disabled }: { t: Say; id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <label htmlFor={id} className="flex min-h-11 items-center gap-3 text-base font-semibold">
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-6 shrink-0 accent-brand-text" />
      <span>{label}</span>
      <span className="ml-auto text-sm font-medium text-muted">{t(checked ? "tu.on" : "tu.off")}</span>
    </label>
  );
}

/**
 * What the Owner can DO in Usage and top-ups (night 4, part F2): buy a pack (+100, +300, +1,000 minutes; the same for messages) through the TEST checkout sheet, switch the auto top-up and the pay-per-use overage on (both OFF until
 * then, each with a monthly limit in rupees), see the pro-rata difference for an upgrade this month and make it, and, in test mode only, set the pretend usage. Only the Owner gets these (the page passes `canChange`; the server and the
 * API refuse anyone else, and ask for the second factor: `mfa`). A read-only workspace gets none. Prices come with the packs: a price that is still a test amount is written "test price". Lazy: the Settings page loads this script only here.
 */
export function TopupControls({ words, packs, settings, upgrades, currentName, canChange, readOnly, mock, actions }: { words: Words; packs: readonly Pack[]; settings: TopupSettings; upgrades: readonly UpgradeTarget[]; currentName: string | null; canChange: boolean; readOnly: boolean; mock: boolean; actions: TopupActions }) {
  const t = makeT(words);
  const move = useTopupMove(t); // the checkout sheet
  const saveMove = useTopupMove(t);
  const upMove = useTopupMove(t);
  const simMove = useTopupMove(t);
  const [sheet, setSheet] = React.useState<Sheet | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [autoOn, setAutoOn] = React.useState(settings.autoMinutesPack !== null || settings.autoMessagesPack !== null);
  const [autoMin, setAutoMin] = React.useState(settings.autoMinutesPack ?? "");
  const [autoMsg, setAutoMsg] = React.useState(settings.autoMessagesPack ?? "");
  const [autoCap, setAutoCap] = React.useState(rupees(settings.autoMonthlyCapPaise));
  const [overMin, setOverMin] = React.useState(settings.overageMinutes);
  const [overMsg, setOverMsg] = React.useState(settings.overageMessages);
  const [overCap, setOverCap] = React.useState(rupees(settings.overageMonthlyCapPaise));
  const [target, setTarget] = React.useState("");
  const [preview, setPreview] = React.useState<UpgradePreview | null>(null);

  if (readOnly || !canChange) {
    return (
      <p role="note" className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-medium" data-topups="controls-off">
        {t(readOnly ? "tu.err.read_only" : "tu.owner_only")}
      </p>
    );
  }

  const open = (s: Omit<Sheet, "id">) => {
    move.setError(null);
    setDone(null);
    setSheet({ ...s, id: crypto.randomUUID() });
  };
  const close = () => {
    setSheet(null);
    setDone(null);
    move.setError(null);
  };
  const pay = async (method: "test_ok" | "test_declined") => {
    if (!sheet) return;
    if (await sheet.pay(sheet.id, method)) setDone(t("tu.pay.done", { what: sheet.what }));
  };

  const buy = (p: Pack) => {
    const what = packWord(t, p);
    open({
      title: t("tu.pay.title", { what }),
      what,
      lines: [
        { label: what, value: formatRupeesShort(p.pricePaise) },
        { label: t("tu.pay.gst", { rate: p.gstRateBp / 100 }), value: formatRupeesShort(p.gstPaise) },
        { label: t("tu.pay.total"), value: formatRupeesShort(p.totalPaise), strong: true },
      ],
      payLabel: t("tu.pay.go", { amount: formatRupeesShort(p.totalPaise) }),
      pay: (id, method) => move.run(() => actions.buy(id, p.code, method)),
    });
  };

  const doPreview = async () => {
    setPreview(null);
    if (!target) return;
    upMove.setError(null);
    const r = await actions.preview(target).catch(() => ({ ok: false as const, error: "not_available" as const }));
    if (r.ok) setPreview(r.preview);
    else upMove.setError(t(`tu.err.${r.error}`));
  };
  const upgradeSheet = (p: UpgradePreview, name: string) => {
    const total = p.totalPaise ?? 0;
    open({
      title: t("tu.pay.title", { what: name }),
      what: name,
      lines:
        p.proratedPaise !== null && p.gstPaise !== null && p.totalPaise !== null
          ? [
              { label: t("tu.up.line.diff", { left: p.daysLeft, days: p.daysInPeriod }), value: formatRupeesShort(p.proratedPaise) },
              { label: t("tu.up.line.gst"), value: formatRupeesShort(p.gstPaise) },
              { label: t("tu.up.line.total"), value: formatRupeesShort(p.totalPaise), strong: true },
            ]
          : [{ label: t("tu.up.line.total"), value: t("tu.up.line.free"), strong: true }],
      payLabel: total > 0 ? t("tu.pay.go", { amount: formatRupeesShort(total) }) : t("tu.up.go.free"),
      pay: (_id, method) => move.run(() => actions.upgrade(p.toPlanId, method)),
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setFormError(null);
    saveMove.setError(null);
    const aCap = autoCap.trim() === "" ? 0 : rupeesToPaise(autoCap);
    const oCap = overCap.trim() === "" ? 0 : rupeesToPaise(overCap);
    if (aCap === null || oCap === null) return setFormError(t("tu.err.invalid"));
    if (autoOn && !autoMin && !autoMsg) return setFormError(t("tu.set.pick_pack"));
    if ((autoOn && aCap <= 0) || ((overMin || overMsg) && oCap <= 0)) return setFormError(t("tu.err.cap_required"));
    const input: SettingsInput = { autoMinutesPack: autoOn && autoMin ? autoMin : null, autoMessagesPack: autoOn && autoMsg ? autoMsg : null, autoMonthlyCapPaise: aCap, overageMinutes: overMin, overageMessages: overMsg, overageMonthlyCapPaise: oCap };
    if (await saveMove.run(() => actions.save(input))) setSaved(true);
  };

  const byKind = (kind: Pack["kind"]) => packs.filter((p) => p.kind === kind);
  const kinds = ["call_minutes", "whatsapp_messages"] as const;
  const rateMin = formatRupeesShort(settings.overageRatePaisePerMinute);
  const rateMsg = formatRupeesShort(settings.overageRatePaisePerMessage);

  return (
    <div className="flex flex-col gap-5" data-topups="controls">
      <section aria-labelledby="tu-packs-h" className={surface}>
        <h3 id="tu-packs-h" className="font-display text-lg font-semibold">
          {t("tu.packs.title")}
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {kinds.map((kind) => (
            <div key={kind}>
              <p className="mb-2 text-sm font-semibold">{t(`tu.packs.${SHORT[kind]}`)}</p>
              <ul className="flex flex-col gap-2">
                {byKind(kind).map((p) => (
                  <li key={p.code}>
                    <button type="button" data-pack={p.code} className={`${btnQuiet} write-ctl w-full flex-col !items-start gap-0.5 py-2 text-left`} onClick={() => buy(p)}>
                      <span className="font-semibold">{packWord(t, p)}</span>
                      <span className="text-sm font-normal text-muted">{priceWord(t, p)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className={fieldHelp}>{t("tu.packs.carry")}</p>
        <p className={fieldHelp}>{t("tu.packs.first")}</p>
      </section>

      <form onSubmit={save} className={surface} aria-labelledby="tu-set-h" data-topups="settings">
        <h3 id="tu-set-h" className="font-display text-lg font-semibold">
          {t("tu.auto.title")}
        </h3>
        <p className={fieldHelp}>{t("tu.auto.sub")}</p>
        <Switch t={t} id="tu-auto" label={t("tu.auto.switch")} checked={autoOn} disabled={saveMove.busy} onChange={(v) => {
          setAutoOn(v);
          if (v && !autoMin && !autoMsg) setAutoMin(byKind("call_minutes")[0]?.code ?? "");
        }} />
        {autoOn ? (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {kinds.map((kind) => {
              const value = kind === "call_minutes" ? autoMin : autoMsg;
              const setValue = kind === "call_minutes" ? setAutoMin : setAutoMsg;
              return (
                <div key={kind}>
                  <label htmlFor={`tu-auto-${kind}`} className={fieldLabel}>
                    {t(`tu.auto.${SHORT[kind]}`)}
                  </label>
                  <select id={`tu-auto-${kind}`} className={fieldInput} value={value} onChange={(e) => setValue(e.target.value)}>
                    <option value="">{t("tu.auto.none")}</option>
                    {byKind(kind).map((p) => (
                      <option key={p.code} value={p.code}>
                        {packWord(t, p)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            <div className="sm:col-span-2">
              <label htmlFor="tu-auto-cap" className={fieldLabel}>
                {t("tu.auto.cap")}
              </label>
              <input id="tu-auto-cap" inputMode="decimal" className={fieldInput} value={autoCap} onChange={(e) => setAutoCap(e.target.value)} />
              <p className={fieldHelp}>{t("tu.auto.spent", { amount: formatRupeesShort(settings.autoSpentPaise) })}</p>
            </div>
          </div>
        ) : null}

        <h3 className="mt-6 font-display text-lg font-semibold">{t("tu.over.title")}</h3>
        <p className={fieldHelp}>{t("tu.over.sub")}</p>
        <Switch t={t} id="tu-over-minutes" label={t("tu.over.minutes")} checked={overMin} disabled={saveMove.busy} onChange={setOverMin} />
        <Switch t={t} id="tu-over-messages" label={t("tu.over.messages")} checked={overMsg} disabled={saveMove.busy} onChange={setOverMsg} />
        {overMin || overMsg ? (
          <div className="mt-2">
            <label htmlFor="tu-over-cap" className={fieldLabel}>
              {t("tu.over.cap")}
            </label>
            <input id="tu-over-cap" inputMode="decimal" className={fieldInput} value={overCap} onChange={(e) => setOverCap(e.target.value)} />
            <p className={fieldHelp}>{t(mock ? "tu.over.rate.test" : "tu.over.rate", { minute: rateMin, message: rateMsg })}</p>
            <p className={fieldHelp}>{t("tu.over.spent", { amount: formatRupeesShort(settings.overageSpentPaise) })}</p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className={btnMain} disabled={saveMove.busy}>
            {t("tu.set.save")}
          </button>
          {saved ? (
            <span role="status" className="text-sm font-medium text-green-text">
              {t("tu.set.saved")}
            </span>
          ) : null}
        </div>
        {formError || saveMove.error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-text">
            {formError ?? saveMove.error}
          </p>
        ) : null}
      </form>

      <section aria-labelledby="tu-up-h" className={surface} data-topups="upgrade">
        <h3 id="tu-up-h" className="font-display text-lg font-semibold">
          {t("tu.up.title")}
        </h3>
        <p className={fieldHelp}>{t("tu.up.sub")}</p>
        {currentName ? <p className="mt-2 text-sm">{t("tu.up.current", { name: currentName })}</p> : null}
        {upgrades.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("tu.up.none")}</p>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="sm:w-72">
                <label htmlFor="tu-up-plan" className={fieldLabel}>
                  {t("tu.up.pick")}
                </label>
                <select
                  id="tu-up-plan"
                  className={fieldInput}
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="">{t("tu.up.choose")}</option>
                  {upgrades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className={btnQuiet} disabled={!target || upMove.busy} onClick={doPreview}>
                {t("tu.up.see")}
              </button>
            </div>
            {preview ? (
              <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3" data-upgrade-preview>
                {preview.proratedPaise !== null && preview.gstPaise !== null && preview.totalPaise !== null ? (
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-base tabular-nums">
                    <dt className="text-muted">{t("tu.up.line.diff", { left: preview.daysLeft, days: preview.daysInPeriod })}</dt>
                    <dd>{formatRupeesShort(preview.proratedPaise)}</dd>
                    <dt className="text-muted">{t("tu.up.line.gst")}</dt>
                    <dd>{formatRupeesShort(preview.gstPaise)}</dd>
                    <dt className="font-semibold">{t("tu.up.line.total")}</dt>
                    <dd className="font-semibold">{formatRupeesShort(preview.totalPaise)}</dd>
                  </dl>
                ) : (
                  <p className="text-base">{t("tu.up.noprice")}</p>
                )}
                {preview.priceSet && mock ? <p className={fieldHelp}>{t("tu.up.testprice")}</p> : null}
                <p className="mt-2 text-sm">
                  {t("tu.up.allow", { minutes: preview.newAllowances.callMinutes === null ? t("tu.up.payg") : count(preview.newAllowances.callMinutes), messages: preview.newAllowances.messages === null ? t("tu.up.payg") : count(preview.newAllowances.messages) })}
                </p>
                <p className="text-sm text-muted">{t("tu.up.same")}</p>
                <div className="mt-3">
                  <button type="button" className={`${btnMain}`} disabled={upMove.busy} onClick={() => upgradeSheet(preview, upgrades.find((u) => u.id === preview.toPlanId)?.name ?? preview.toPlanId)}>
                    {t("tu.up.go", { name: upgrades.find((u) => u.id === preview.toPlanId)?.name ?? preview.toPlanId })}
                  </button>
                </div>
              </div>
            ) : null}
            {upMove.error ? (
              <p role="alert" className="mt-2 text-sm font-medium text-red-text">
                {upMove.error}
              </p>
            ) : null}
          </>
        )}
      </section>

      {actions.simulate ? (
        <section aria-labelledby="tu-sim-h" className="rounded-xl border border-dashed border-amber-text p-4" data-topups="simulate">
          <h3 id="tu-sim-h" className="text-base font-semibold">
            {t("tu.sim.title")}
          </h3>
          <p className={fieldHelp}>{t("tu.sim.note")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[50, 80, 100].map((p) => (
              <button key={p} type="button" className={btnQuiet} disabled={simMove.busy} onClick={() => void simMove.run(() => actions.simulate!(p))}>
                {t("tu.sim.set", { n: p })}
              </button>
            ))}
            <button type="button" className={btnQuiet} disabled={simMove.busy} onClick={() => void simMove.run(() => actions.simulate!(0))}>
              {t("tu.sim.month")}
            </button>
          </div>
          {simMove.error ? (
            <p role="alert" className="mt-2 text-sm font-medium text-red-text">
              {simMove.error}
            </p>
          ) : null}
        </section>
      ) : null}

      {sheet ? <CheckoutSheet t={t} title={sheet.title} lines={sheet.lines} payLabel={sheet.payLabel} busy={move.busy} error={move.error} done={done} onPay={pay} onClose={close} /> : null}
    </div>
  );
}
