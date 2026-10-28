"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";
import { LINE_MAX, LINE_MIN, PLACEHOLDERS, SAMPLE_CUSTOMER, SAMPLE_ROLE, fillOpening, unknownPlaceholders, validLine, type Lines, type Preview } from "@/lib/opening-line/types";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldLabel, fieldTextarea, okBox, surface, warnBox } from "../ui";
import { makeT, type Words } from "../words";

type SaveOut = { ok: true } | { ok: false; error: string };
export type OpeningLineActions = { save: (input: unknown) => Promise<SaveOut>; preview: ((language: CallLang, text: string, mentionAi: boolean) => Promise<{ ok: true; preview: Preview } | { ok: false; error: string }>) | null };
/** `workspace`: the business's own opening line. `campaign`: the same two settings for ONE campaign, where an empty text follows the business and the switch can follow it too. */
export type Scope = { kind: "workspace" } | { kind: "campaign"; backHref: string };
const WARNED = "sme-opening-ai-warned";
const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;

/**
 * Settings > AI assistant > "Opening line" (night 5): what the assistant says first on a call. A box per language with the four placeholders as buttons, a live preview of the words with made-up values (the customer's first name, the
 * assistant's and the business's own names), "Hear it" (the workspace's voice and style, through the API's preview), "Reset to default", and the switch "Mention that I'm an AI assistant in the greeting" (on by default). Turning it OFF says
 * ONCE (this browser) that the assistant still answers honestly if it is asked, and that some regulators expect AI calls to be disclosed. Only the Owner changes it. `lines` are the languages with a text of their own; `fallback` is what a
 * language without one uses (the default, or for a campaign what the business uses). For a campaign `mentionAi` null means "same as the business" (`effectiveAi`).
 */
export function OpeningLine({ words, langNames, scope, lines, fallback, mentionAi, effectiveAi, names, canEdit, mock, actions }: { words?: Words; langNames: Record<CallLang, string>; scope: Scope; lines: Lines; fallback: Record<CallLang, string>; mentionAi: boolean | null; effectiveAi: boolean; names: { assistant: string; business: string }; canEdit: boolean; mock: boolean; actions: OpeningLineActions }) {
  const t = makeT(words);
  const router = useRouter();
  const campaign = scope.kind === "campaign";
  const [lang, setLang] = React.useState<CallLang>(CALL_LANGS.find((l) => lines[l] !== undefined) ?? "te");
  const [own, setOwn] = React.useState<Lines>(lines);
  const [touched, setTouched] = React.useState<CallLang[]>([]);
  const [ai, setAi] = React.useState<boolean | null>(campaign ? mentionAi : (mentionAi ?? true));
  const [aiTouched, setAiTouched] = React.useState(false);
  const [warn, setWarn] = React.useState(false);
  const [busy, startSave] = React.useTransition();
  const [heard, setHeard] = React.useState<"idle" | "busy" | "none" | "error">("idle");
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const area = React.useRef<HTMLTextAreaElement>(null);
  const player = React.useRef<HTMLAudioElement | null>(null);

  const value = own[lang] ?? fallback[lang];
  const effective = ai ?? effectiveAi;
  const values = { customer: SAMPLE_CUSTOMER[lang], assistant: names.assistant, business: names.business, agent_role: SAMPLE_ROLE[lang] };
  const preview = fillOpening(value, values);
  const unknown = unknownPlaceholders(value);
  const problem = unknown.length > 0 ? t("ope.err.unknown", { names: unknown.map((n) => `{${n}}`).join(", ") }) : value.trim().length < LINE_MIN ? t("ope.err.short", { n: LINE_MIN }) : value.length > LINE_MAX ? t("ope.err.long", { n: LINE_MAX }) : null;
  const usesDefault = own[lang] === undefined;
  const dirty = touched.length > 0 || aiTouched;

  const edit = (l: CallLang, text: string | undefined) => {
    setMessage(null);
    setOwn((o) => {
      const next = { ...o };
      if (text === undefined || text === fallback[l]) delete next[l];
      else next[l] = text;
      return next;
    });
    setTouched((x) => (x.includes(l) ? x : [...x, l]));
  };
  const insert = (name: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    const text = `${value.slice(0, at)}{${name}}${value.slice(end)}`;
    edit(lang, text);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + name.length + 2;
      el?.setSelectionRange(pos, pos);
    });
  };
  const turnAi = (on: boolean | null) => {
    setAi(on);
    setAiTouched(true);
    setMessage(null);
    if (on === false) {
      try {
        if (!localStorage.getItem(WARNED)) {
          localStorage.setItem(WARNED, "1");
          setWarn(true);
        }
      } catch {
        setWarn(true);
      }
    } else setWarn(false);
  };
  const hear = async () => {
    if (!actions.preview || problem) return;
    setHeard("busy");
    try {
      const out = await actions.preview(lang, preview, effective);
      if (!out.ok) return setHeard("error");
      if (!out.preview.audio) return setHeard("none");
      player.current?.pause();
      // a blob: address, not a data: one: the page's media rule allows only this app's own address and blob: (lib/security/csp.ts)
      const bytes = Uint8Array.from(atob(out.preview.audio.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: out.preview.audio.mime }));
      const audio = new Audio(url);
      player.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setHeard("idle");
      };
      await audio.play();
      setHeard("idle");
    } catch {
      setHeard("error");
    }
  };
  const save = () => {
    const sent: Record<string, string | null> = {};
    for (const l of touched) {
      const text = own[l];
      if (text !== undefined && !validLine(text)) return setMessage({ ok: false, text: t("ope.err.invalid") });
      sent[l] = text === undefined ? null : text.trim();
    }
    startSave(async () => {
      const out = await actions.save({ lines: sent, mentionAi: ai });
      if (out.ok) {
        setTouched([]);
        setAiTouched(false);
        setMessage({ ok: true, text: t("ope.saved") });
        router.refresh();
      } else setMessage({ ok: false, text: t(`ope.err.${out.error}` as "ope.err.down") });
    });
  };

  return (
    <section className={surface} aria-labelledby="ope-h" data-part="opening-line" data-scope={scope.kind}>
      <h2 id="ope-h" className="font-display text-xl font-semibold">
        {campaign ? t("ope.c.title") : t("ope.title")}
      </h2>
      <p className={fieldHelp}>{campaign ? t("ope.c.sub") : t("ope.sub")}</p>
      {mock ? <p className={warnBox}>{t("ope.mock")}</p> : null}
      {canEdit ? null : <p className={fieldHelp}>{t("ope.owneronly")}</p>}

      <div role="group" aria-label={t("ope.lang")} className="mt-4 flex flex-wrap gap-2">
        {CALL_LANGS.map((l) => (
          <button key={l} type="button" aria-pressed={l === lang} onClick={() => setLang(l)} className={chip(l === lang)}>
            {langNames[l]}
            {own[l] !== undefined ? <span aria-hidden="true"> ·</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor="ope-text" className={fieldLabel}>
          {t("ope.text")}
        </label>
        <textarea id="ope-text" ref={area} lang={lang} rows={3} maxLength={LINE_MAX + 40} value={value} disabled={!canEdit} onChange={(e) => edit(lang, e.target.value)} aria-invalid={problem !== null} aria-describedby="ope-help" className={fieldTextarea} />
        <p id="ope-help" className={fieldHelp}>
          {usesDefault ? (campaign ? t("ope.c.following") : t("ope.default")) : t("ope.own")}
        </p>
        {problem ? <p role="alert" className="mt-1.5 text-sm font-medium text-red-text">{problem}</p> : null}
        {canEdit ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">{t("ope.insert")}</span>
            {PLACEHOLDERS.map((p) => (
              <button key={p} type="button" onClick={() => insert(p)} className="min-h-11 rounded-full border border-edge bg-surface px-3 font-mono text-sm hover:bg-surface-2">
                {`{${p}}`}
              </button>
            ))}
            <button type="button" disabled={usesDefault} onClick={() => edit(lang, undefined)} className={`${btnQuiet} ml-auto`}>
              {campaign ? t("ope.c.reset") : t("ope.reset")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl bg-surface-2 p-4" data-part="opening-preview">
        <p className="text-sm font-semibold text-muted">{t("ope.preview")}</p>
        <p lang={lang} className="mt-1 text-lg" aria-live="polite">
          {preview}
        </p>
        {actions.preview ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={hear} disabled={heard === "busy" || problem !== null || (dirty && !mock)} className={btnQuiet}>
              {heard === "busy" ? t("ope.hearing") : t("ope.hear")}
            </button>
            <p className="min-w-0 flex-1 text-sm text-muted">{dirty && !mock ? t("ope.hear.save") : t("ope.hear.note")}</p>
          </div>
        ) : null}
        {heard === "none" ? <p role="status" className={fieldHelp}>{t("ope.hear.none")}</p> : null}
        {heard === "error" ? <p role="alert" className="mt-1.5 text-sm font-medium text-red-text">{t("ope.hear.err")}</p> : null}
      </div>

      <div className="mt-5" data-part="mention-ai">
        {campaign ? (
          <fieldset>
            <legend className={fieldLabel}>{t("ope.ai.label")}</legend>
            <div className="flex flex-wrap gap-2">
              {([null, true, false] as const).map((v) => (
                <button key={String(v)} type="button" disabled={!canEdit} aria-pressed={ai === v} onClick={() => turnAi(v)} className={chip(ai === v)}>
                  {v === null ? t("ope.c.same") : v ? t("ope.c.yes") : t("ope.c.no")}
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
            <input type="checkbox" role="switch" checked={effective} disabled={!canEdit} onChange={(e) => turnAi(e.target.checked)} className="size-6 shrink-0 accent-brand-text" />
            {t("ope.ai.label")}
          </label>
        )}
        <p className={fieldHelp}>{t("ope.ai.help")}</p>
        {warn ? (
          <div role="note" className={warnBox} data-part="ai-warning">
            <p>{t("ope.ai.warn")}</p>
            <button type="button" onClick={() => setWarn(false)} className={`${btnQuiet} mt-2`}>
              {t("ope.ai.ok")}
            </button>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={busy || !dirty || problem !== null} className={btnMain}>
            {busy ? t("ope.saving") : t("ope.save")}
          </button>
          {campaign ? (
            <a href={scope.backHref} className={btnQuiet}>
              {t("ope.c.back")}
            </a>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? okBox : alertBox}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
