"use client";

import * as React from "react";

import { ASK_FIRST, type AskFirst, type Autonomy } from "@/lib/employees/types";

import { Tick } from "../../ds/Tick";
import { fieldHelp } from "../../ui";
import { makeT } from "../../words";
import { Card, SaveBar, TextField, same, useSave, type TabProps } from "./shared";

type Change = { -readonly [K in keyof Autonomy]?: Autonomy[K] };
const MAYS = [
  ["mayAnswerPrices", "emp.page.may.prices"],
  ["mayBookVisits", "emp.page.may.visits"],
  ["maySendMedia", "emp.page.may.media"],
  ["mayTalkDues", "emp.page.may.dues"],
] as const satisfies readonly (readonly [keyof Autonomy, string])[];

/** What it may do alone: the ask-first list of the seven actions, four may-do switches and the biggest discount it may give. `locked` = the main assistant (set in My assistant) or a reader. */
export function AutonomyCard({ emp, words, actions, onChange, locked }: TabProps & { locked: boolean }) {
  const t = makeT(words);
  const a = emp.autonomy;
  const [ask, setAsk] = React.useState<string[]>([...emp.askFirst]);
  const [may, setMay] = React.useState<Record<(typeof MAYS)[number][0], boolean>>({ mayAnswerPrices: a.mayAnswerPrices, mayBookVisits: a.mayBookVisits, maySendMedia: a.maySendMedia, mayTalkDues: a.mayTalkDues });
  const [pct, setPct] = React.useState(String(a.maxDiscountPercent));
  const save = useSave(onChange);
  const askNow = ASK_FIRST.filter((x) => ask.includes(x));
  const pctOk = /^\d{1,3}$/.test(pct.trim()) && Number(pct) <= 100;
  const build = () => {
    const autonomy: Change = {};
    for (const [k] of MAYS) if (may[k] !== a[k]) (autonomy as Record<string, boolean>)[k] = may[k];
    if (pctOk && Number(pct) !== a.maxDiscountPercent) autonomy.maxDiscountPercent = Number(pct);
    const patch: { askFirst?: readonly AskFirst[]; autonomy?: Change } = {};
    if (!same([...emp.askFirst].sort(), [...askNow].sort())) patch.askFirst = askNow;
    if (Object.keys(autonomy).length) patch.autonomy = autonomy;
    return patch;
  };
  const patch = build();
  const dirty = Object.keys(patch).length > 0 || (!pctOk && pct !== String(a.maxDiscountPercent));
  const touch = () => save.clear();
  return (
    <Card title={t("emp.page.rules.alone")} desc={t("emp.page.rules.alone_help")}>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">{t("emp.page.rules.ask")}</legend>
        <p className={`${fieldHelp} mb-1 mt-0`}>{t("emp.page.rules.ask_help")}</p>
        {ASK_FIRST.map((x) => (
          <Tick key={x} label={t(`emp.ask.${x}`)} checked={ask.includes(x)} disabled={locked} onChange={(e) => (setAsk((p) => (e.target.checked ? [...p, x] : p.filter((y) => y !== x))), touch())} />
        ))}
      </fieldset>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">{t("emp.page.rules.may")}</legend>
        {MAYS.map(([k, key]) => (
          <Tick key={k} role="switch" label={t(key)} checked={may[k]} disabled={locked} onChange={(e) => (setMay((p) => ({ ...p, [k]: e.target.checked })), touch())} />
        ))}
      </fieldset>
      <TextField id="emp-discount" inputMode="numeric" label={t("emp.page.rules.discount")} help={t("emp.page.rules.discount_help")} value={pct} max={3} disabled={locked} onChange={(v) => (setPct(v), touch())} />
      {!locked ? <SaveBar words={words} state={save} onSave={() => (pctOk ? void save.run(() => actions.patch(patch)) : save.fail("validation_error"))} disabled={!dirty} /> : null}
    </Card>
  );
}

/** When it hands the call to a person: the owner asks, the customer is upset, an order above an amount (empty = never). */
export function HandoverCard({ emp, words, actions, onChange, locked }: TabProps & { locked: boolean }) {
  const t = makeT(words);
  const a = emp.autonomy;
  const [owner, setOwner] = React.useState(a.handoverOwnerAsked);
  const [upset, setUpset] = React.useState(a.handoverUpset);
  const [rupees, setRupees] = React.useState(a.handoverOrderAbovePaise === null ? "" : String(Math.round(a.handoverOrderAbovePaise / 100)));
  const save = useSave(onChange);
  const amount = rupees.trim();
  const amountOk = amount === "" || /^\d{1,9}$/.test(amount);
  const paise = amount === "" ? null : Number(amount) * 100;
  const autonomy: Change = {};
  if (owner !== a.handoverOwnerAsked) autonomy.handoverOwnerAsked = owner;
  if (upset !== a.handoverUpset) autonomy.handoverUpset = upset;
  if (amountOk && paise !== a.handoverOrderAbovePaise) autonomy.handoverOrderAbovePaise = paise;
  const touch = () => save.clear();
  return (
    <Card title={t("emp.page.rules.handover")} desc={t("emp.page.rules.handover_help")}>
      <div>
        <Tick role="switch" label={t("emp.page.rules.h_owner")} checked={owner} disabled={locked} onChange={(e) => (setOwner(e.target.checked), touch())} />
        <Tick role="switch" label={t("emp.page.rules.h_upset")} checked={upset} disabled={locked} onChange={(e) => (setUpset(e.target.checked), touch())} />
      </div>
      <TextField id="emp-order-above" inputMode="numeric" label={t("emp.page.rules.h_order")} help={t("emp.page.rules.h_order_help")} value={rupees} max={9} disabled={locked} onChange={(v) => (setRupees(v), touch())} />
      {!locked ? <SaveBar words={words} state={save} onSave={() => (amountOk ? void save.run(() => actions.patch({ autonomy })) : save.fail("validation_error"))} disabled={Object.keys(autonomy).length === 0 && amountOk} /> : null}
    </Card>
  );
}
