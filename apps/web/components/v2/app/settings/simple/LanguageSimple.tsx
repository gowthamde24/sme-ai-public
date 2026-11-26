"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState, useTransition } from "react";

import { saveLang } from "@/components/v2/controls/LangSelect";
import { applyTheme, type ThemePick } from "@/components/v2/controls/ThemeChoice";
import { LANGS, LANGUAGE_NAMES, type Lang } from "@/i18n/lang";
import { readLang } from "@/i18n/preferences";
import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";

import { JobChip } from "../../ds/JobChip";
import { Choose } from "../../jobs/rules/parts";
import { errorLine, okLine, primary } from "../../visits/styles";
import { makeT } from "../../words";
import { SaveBar, SelectField, TickGroup } from "./fields";
import { EffectBox, MultiPanel, PillMulti, Sentence, Val, joinNames } from "./parts";

type State = { ok: true } | { ok: false; error: string } | undefined;
const THEMES: readonly ThemePick[] = ["system", "light", "dark"];
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Language and theme under JOBS (the simplicity pass): "The app speaks [Telugu]. My assistant speaks to customers in [Telugu and English]. The app looks [like my phone]." The app's language and the look answer at once (the cookie and the page,
 * as the old controls did); the assistant's languages are the business languages, saved with ONE Save through the same action as Settings > Business (the name and city sent as they are, so only the languages change).
 * Someone who may not change the business reads the assistant's languages without a choice (`assistant` is null).
 */
export function LanguageSimple({ words, lang, theme, assistant, bare = false, plain = false }: { /** SETTINGS_OPEN: plain labelled fields. */ plain?: boolean; words: Readonly<Record<string, string>>; lang: Lang; theme: ThemePick; /** the business's own languages and the action that saves them (the Owner or an Admin); `save` null = read only; null = the business could not be read */ assistant: { name: string; town: string; languages: readonly string[]; choices: readonly CallLang[]; save: ((prev: State, formData: FormData) => Promise<State>) | null } | null; bare?: boolean }) {
  const t = makeT(words);
  const uid = useId();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [appLang, setAppLang] = useState<Lang>(lang);
  const [look, setLook] = useState<ThemePick>(theme);
  const save = assistant?.save ?? null;
  const canSave = save !== null;
  const initial = assistant ? (assistant.choices.filter((c) => assistant.languages.includes(c)) as string[]) : [];
  const [base, setBase] = useState(initial);
  const [langs, setLangs] = useState(initial);
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(async (prev: State, formData: FormData) => {
    const result = await (save as NonNullable<typeof save>)(prev, formData);
    if (result?.ok) setBase(formData.getAll("languages").map(String));
    return result;
  }, undefined);
  const dirty = !same(langs, base);
  const and = (a: string, b: string) => t("jobs.set.and", { a, b });
  const names = (list: readonly string[]) => joinNames(and, list.map((l) => CALL_LANG_NAMES[l as CallLang] ?? l));
  const changeApp = (v: string) => {
    const next = readLang(v);
    setAppLang(next);
    saveLang(next);
    startTransition(() => router.refresh());
  };
  const changeLook = (v: string) => {
    setLook(v as ThemePick);
    applyTheme(v as ThemePick);
  };
  const fxLook = t(`jobs.set.lang.fx.theme.${look}`);
  const fx = langs.length > 0 ? t("jobs.set.lang.fx", { app: LANGUAGE_NAMES[appLang].native, theme: fxLook, langs: names(langs) }) : t("jobs.set.lang.fx.nolang", { app: LANGUAGE_NAMES[appLang].native, theme: fxLook });
  const plainBody = (
    <form action={run} className="flex flex-col gap-5" data-part="language-simple" data-plain="">
      <SelectField label={t("settings.language.language")} hint={t("jobs.set.lang.help")} value={appLang} options={LANGS.map((l) => ({ value: l, label: LANGUAGE_NAMES[l as Lang].native }))} onChange={changeApp} />
      <SelectField label={t("settings.language.appearance")} value={look} options={THEMES.map((k) => ({ value: k, label: t(`jobs.set.lang.theme.${k}`) }))} onChange={changeLook} />
      {assistant && canSave ? (
        <>
          <TickGroup legend={t("settings.biz.langs")} hint={t("settings.biz.langs.help")} options={assistant.choices.map((c) => ({ value: c, label: CALL_LANG_NAMES[c] }))} values={langs} onChange={setLangs} disabled={pending} />
          <input type="hidden" name="name" value={assistant.name} />
          <input type="hidden" name="town" value={assistant.town} />
          {langs.map((l) => (
            <input key={l} type="hidden" name="languages" value={l} />
          ))}
        </>
      ) : assistant ? (
        <p className="m-0 text-[16px] text-muted">
          <span className="font-semibold text-ink">{t("settings.biz.langs")}: </span>
          {names(initial) || t("jobs.set.na")}
        </p>
      ) : null}
      {state && !state.ok ? (
        <p role="alert" className={errorLine}>
          {t(`settings.biz.err.${state.error}`)}
        </p>
      ) : null}
      {canSave ? <SaveBar dirty={dirty} saved={!!state?.ok} pending={pending} label={t("jobs.set.save")} unsaved={t("set.f.unsaved")} done={t("set.f.saved")} onClass={`${primary} jb-press`} /> : null}
    </form>
  );
  const body = plain ? plainBody : (
    <form action={run} className="flex flex-col gap-3" data-part="language-simple">
      <p className="m-0 text-[14px] text-muted">{t("jobs.set.lang.help")}</p>
      <Sentence line="app" template={t("jobs.set.lang.line.app")} parts={{ app: (aria) => <Choose aria={aria} value={appLang} options={LANGS} text={(l) => LANGUAGE_NAMES[l as Lang].native} onChange={changeApp} /> }} />
      {assistant ? (
        canSave ? (
          <>
            <Sentence line="assistant" template={t("jobs.set.lang.line.assistant")} parts={{ langs: (aria) => <PillMulti aria={aria} text={names(langs) || t("jobs.set.na")} open={open} controls={`${uid}-langs`} onToggle={() => setOpen((o) => !o)} /> }} />
            <MultiPanel id={`${uid}-langs`} open={open} options={assistant.choices.map((c) => ({ value: c, label: CALL_LANG_NAMES[c] }))} values={langs} onChange={setLangs} />
            <input type="hidden" name="name" value={assistant.name} />
            <input type="hidden" name="town" value={assistant.town} />
            {langs.map((l) => (
              <input key={l} type="hidden" name="languages" value={l} />
            ))}
          </>
        ) : (
          <Sentence line="assistant" template={t("jobs.set.lang.line.assistant")} parts={{ langs: () => <Val>{names(initial) || t("jobs.set.na")}</Val> }} />
        )
      ) : null}
      <Sentence line="theme" template={t("jobs.set.lang.line.theme")} parts={{ theme: (aria) => <Choose aria={aria} value={look} options={THEMES} text={(k) => t(`jobs.set.lang.theme.${k}`)} onChange={changeLook} /> }} />
      <EffectBox label={t("jobs.set.effect")} text={fx} />
      {state && !state.ok ? (
        <p role="alert" className={errorLine}>
          {t(`settings.biz.err.${state.error}`)}
        </p>
      ) : null}
      {state?.ok && !dirty ? (
        <p role="status" className={okLine}>
          {t("jobs.set.lang.saved")}
        </p>
      ) : null}
      {canSave ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending || !dirty} className={`${primary} jb-press`}>
            {t("jobs.set.save")}
          </button>
          {dirty && !pending ? <JobChip tone="wait">{t("jobs.set.chip.dirty")}</JobChip> : null}
          {state?.ok && !dirty ? <JobChip tone="done">{t("jobs.set.chip.saved")}</JobChip> : null}
        </div>
      ) : null}
    </form>
  );
  if (bare) return body;
  return (
    <section aria-labelledby="lang-simple-title" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5" data-part="language">
      <h2 id="lang-simple-title" className="m-0 font-display text-[17px] font-bold leading-tight text-ink">
        {t("settings.language.language")} / {t("settings.language.appearance")}
      </h2>
      {body}
    </section>
  );
}
