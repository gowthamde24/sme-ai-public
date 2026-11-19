"use client";

import { useActionState, useId, useState, type ReactNode } from "react";

import { TypeCombobox } from "@/components/v2/auth/TypeCombobox";
import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";

import { JobChip } from "../../ds/JobChip";
import { errorLine, okLine, primary } from "../../visits/styles";
import { makeT } from "../../words";
import type { OwnerFields } from "../BusinessForm";
import { EffectBox, MoreChoices, MultiPanel, PillMulti, PillText, Sentence, Val, joinNames } from "./parts";

type State = { ok: true } | { ok: false; error: string } | undefined;
type Address = { line: string | null; area: string | null; pincode: string | null };
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Settings > Business under JOBS (the simplicity pass): the business as plain sentences with the choice inside ("My business is called [name]. It is in [city]."), the languages as one choice (a pill that opens round ticks), a live "What it will do:" line,
 * the rare things under "More choices" and ONE Save that sends the SAME form as the old cards (`name`, `town`, `languages`, and for the Owner `phone`, `type`, `other_label`, `address_line`, `area`, `pincode`: a field is sent only where the old form had it).
 * `variant="card"` is the card of the Settings page (name and city, the address for the Owner, the languages kept as they are; `children` are the rows under "More choices"), `variant="page"` is the Business tab (name, city, languages; kind and phone for the Owner).
 * Someone who may not change it reads the same sentences, without choices.
 */
export function BusinessSimple({ variant, words, action, name, town, languages, choices, canEdit, owner = null, address = null, canEditAddress = false, children }: { variant: "card" | "page"; words: Readonly<Record<string, string>>; action: (prev: State, formData: FormData) => Promise<State>; name: string; town: string; languages: readonly string[]; choices: readonly CallLang[]; canEdit: boolean; owner?: OwnerFields | null; address?: Address | null; canEditAddress?: boolean; children?: ReactNode }) {
  const t = makeT(words);
  const uid = useId();
  const page = variant === "page";
  const initial = { name, town, phone: owner?.phone ?? "", line: address?.line ?? "", area: address?.area ?? "", pin: address?.pincode ?? "" };
  const [base, setBase] = useState({ ...initial, langs: choices.filter((c) => languages.includes(c)) as string[] });
  const [v, setV] = useState(base);
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(async (prev: State, formData: FormData) => {
    const result = await action(prev, formData);
    if (result?.ok) {
      const val = (k: string) => String(formData.get(k) ?? "");
      setBase((b) => ({ ...b, name: val("name").trim(), town: val("town").trim(), phone: formData.has("phone") ? val("phone").trim() : b.phone, line: formData.has("address_line") ? val("address_line").trim() : b.line, area: formData.has("area") ? val("area").trim() : b.area, pin: formData.has("pincode") ? val("pincode").trim() : b.pin, langs: formData.getAll("languages").map(String) }));
      setTouched(false);
    }
    return result;
  }, undefined);
  const set = (patch: Partial<typeof v>) => setV((cur) => ({ ...cur, ...patch }));
  const dirty = touched || v.name !== base.name || v.town !== base.town || v.phone !== base.phone || v.line !== base.line || v.area !== base.area || v.pin !== base.pin || !same(v.langs, base.langs);
  const and = (a: string, b: string) => t("jobs.set.and", { a, b });
  const langNames = (list: readonly string[]) => joinNames(and, list.map((l) => CALL_LANG_NAMES[l as CallLang] ?? l));
  const showLangs = page;

  const nameLine = (edit: boolean) => (
    <Sentence
      line="name"
      template={t("jobs.set.biz.line.name")}
      parts={{ name: (aria) => (edit ? <PillText aria={aria} name="name" value={v.name} onChange={(x) => set({ name: x })} placeholder={t("jobs.set.biz.ph.name")} maxLength={120} required autoComplete="organization" disabled={pending} /> : <Val>{name}</Val>) }}
    />
  );
  const cityLine = (edit: boolean) => (
    <Sentence
      line="city"
      template={t("jobs.set.biz.line.city")}
      parts={{ city: (aria) => (edit ? <PillText aria={aria} name="town" value={v.town} onChange={(x) => set({ town: x })} placeholder={t("jobs.set.biz.ph.city")} minLength={2} maxLength={80} autoComplete="address-level2" disabled={pending} /> : town ? <Val>{town}</Val> : <span className="text-muted">{t("jobs.set.na")}</span>) }}
    />
  );
  const addressLine = (edit: boolean) =>
    edit ? (
      <Sentence
        line="address"
        template={t("jobs.set.biz.line.addr")}
        parts={{
          line: (aria) => <PillText aria={aria} name="address_line" value={v.line} onChange={(x) => set({ line: x })} placeholder={t("jobs.set.biz.ph.line")} minLength={3} maxLength={160} autoComplete="address-line1" disabled={pending} />,
          area: (aria) => <PillText aria={`${aria} (2)`} name="area" value={v.area} onChange={(x) => set({ area: x })} placeholder={t("jobs.set.biz.ph.area")} minLength={2} maxLength={80} disabled={pending} />,
          pin: (aria) => <PillText aria={`${aria} (3)`} name="pincode" value={v.pin} onChange={(x) => set({ pin: x })} placeholder={t("jobs.set.biz.ph.pin")} inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} autoComplete="postal-code" disabled={pending} />,
        }}
      />
    ) : address && (address.line || address.area || address.pincode) ? (
      <Sentence line="address" template={t("jobs.set.biz.line.addr")} parts={{ line: () => <Val>{address.line ?? "-"}</Val>, area: () => <Val>{address.area ?? "-"}</Val>, pin: () => <Val>{address.pincode ?? "-"}</Val> }} />
    ) : null;

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-1" data-part="business-simple" data-readonly="">
        {nameLine(false)}
        {cityLine(false)}
        {showLangs && base.langs.length > 0 ? <Sentence line="langs" template={t("jobs.set.biz.line.langs")} parts={{ langs: () => <Val>{langNames(base.langs)}</Val> }} /> : null}
        {addressLine(false)}
        {children ? <MoreChoices title={t("jobs.set.more")} sub={t(page ? "jobs.set.biz.more_sub.page" : "jobs.set.biz.more_sub.card")}>{children}</MoreChoices> : null}
      </div>
    );
  }

  const fx = v.langs.length > 0 && showLangs ? t("jobs.set.biz.fx", { name: v.name.trim() || name, langs: langNames(v.langs) }) : t("jobs.set.biz.fx.nolang", { name: v.name.trim() || name });
  const ownerMore = page && owner !== null;
  const kind = page && owner && owner.groups.length > 0 ? owner : null;
  return (
    <form action={run} onChange={() => setTouched(true)} className="flex flex-col gap-3" data-part="business-simple">
      <p className="m-0 text-[14px] text-muted">{t("jobs.set.biz.help")}</p>
      {nameLine(true)}
      {cityLine(true)}
      {showLangs ? (
        <>
          <Sentence line="langs" template={t("jobs.set.biz.line.langs")} parts={{ langs: (aria) => <PillMulti aria={aria} text={langNames(v.langs) || t("jobs.set.na")} open={open} controls={`${uid}-langs`} onToggle={() => setOpen((o) => !o)} /> }} />
          <MultiPanel id={`${uid}-langs`} open={open} options={choices.map((c) => ({ value: c, label: CALL_LANG_NAMES[c] }))} values={v.langs} onChange={(next) => { set({ langs: next }); setTouched(true); }}>
            <p className="m-0 pb-2 text-sm text-muted">{t("settings.biz.langs.help")}</p>
          </MultiPanel>
        </>
      ) : null}
      {(showLangs ? v.langs : base.langs).map((l) => (
        <input key={l} type="hidden" name="languages" value={l} />
      ))}
      {!page ? addressLine(canEditAddress) : null}
      <EffectBox label={t("jobs.set.effect")} text={fx} />
      {ownerMore || children ? (
        <MoreChoices title={t("jobs.set.more")} sub={t(page ? "jobs.set.biz.more_sub.page" : "jobs.set.biz.more_sub.card")}>
          {kind ? <TypeCombobox groups={kind.groups} words={kind.typeWords} otherId={kind.otherId} initial={kind.type} otherInitial={kind.typeLabel} /> : null}
          {kind ? <p className="m-0 text-sm text-muted">{t("settings.biz.type.note")}</p> : null}
          {ownerMore ? <Sentence line="phone" template={t("jobs.set.biz.line.phone")} parts={{ phone: (aria) => <PillText aria={aria} name="phone" value={v.phone} onChange={(x) => set({ phone: x })} placeholder={t("jobs.set.biz.ph.phone")} inputMode="tel" maxLength={20} autoComplete="tel" disabled={pending} /> }} /> : null}
          {children}
        </MoreChoices>
      ) : null}
      {state && !state.ok ? (
        <p role="alert" className={errorLine}>
          {t(`settings.biz.err.${state.error}`)}
        </p>
      ) : null}
      {state?.ok && !dirty ? (
        <p role="status" className={okLine}>
          {t(page ? "settings.biz.saved" : "sv6.biz.published")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !dirty} className={`${primary} jb-press`}>
          {t(page ? "settings.biz.save" : "catalogue.v6.publish")}
        </button>
        {dirty && !pending ? <JobChip tone="wait">{t("jobs.set.chip.dirty")}</JobChip> : null}
        {state?.ok && !dirty ? <JobChip tone="done">{t("jobs.set.chip.saved")}</JobChip> : null}
      </div>
    </form>
  );
}
