"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { CALL_LANGS } from "@/lib/assistant/types";
import { parseList } from "@/lib/tasks/list";
import { INSTRUCTION_MAX, INSTRUCTION_MIN, type TaskLang, type TemplateOut } from "@/lib/tasks/types";

import { alertBox, btnMain, fieldInput, fieldLabel, fieldTextarea, mutedText, noteBox, surface } from "../ui";
import { makeT, type Words } from "../words";
import type { TaskActions } from "./task-actions";
import { langName } from "./task-format";

const chip = "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold hover:bg-surface-2";

/**
 * The box of the Tasks page (night 4, job DR part B): "What should Vijaya do?", the ready-made task chips (a chip puts its example into the box for the owner to change), the language of the customers (or "same as I wrote"), an optional pasted
 * list, and "Make a plan". Nothing is called or sent by this: the plan opens on its own page where the Owner approves once. Anyone but Owner, Admin and Sales reads only (`canPlan` false: a sentence instead of the box).
 * `initial` pre-fills the box (a link from another screen: `?instruction=`) and `focus` puts the cursor in it (`?new=1`).
 */
export function TaskComposer({ words, base, actions, templates, canPlan, initial = "", focus = false }: { words: Words; base: string; actions: TaskActions; templates: readonly TemplateOut[]; canPlan: boolean; initial?: string; focus?: boolean }) {
  const t = makeT(words);
  const router = useRouter();
  const [text, setText] = React.useState(initial.slice(0, INSTRUCTION_MAX));
  const [language, setLanguage] = React.useState<TaskLang | "auto">("auto");
  const [list, setList] = React.useState("");
  const [picked, setPicked] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const box = React.useRef<HTMLTextAreaElement>(null);
  const taskId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (focus) box.current?.focus();
  }, [focus]);
  if (!canPlan)
    return (
      <p data-part="viewer" className={`${noteBox} !mt-0`}>
        {t("tk.viewer")}
      </p>
    );
  const parsed = parseList(list);
  const promo = templates.find((x) => x.id === picked && x.promotional);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const instruction = text.trim();
    if (instruction.length < INSTRUCTION_MIN || busy) return;
    setBusy(true);
    setError(null);
    taskId.current ??= crypto.randomUUID(); // the same id again is a replay: a double press or a retry makes ONE task
    try {
      const got = await actions.plan(taskId.current, instruction, language === "auto" ? null : language, parsed.people);
      if (got.ok) router.push(`${base}/tasks/${got.task.id}`);
      else {
        setError(got.error);
        if (got.error === "invalid") taskId.current = null;
      }
    } catch {
      setError("down");
    }
    setBusy(false);
  };
  return (
    <form data-part="composer" onSubmit={(e) => void submit(e)} className={`${surface} flex flex-col gap-3`}>
      <label htmlFor="task-instruction" className={fieldLabel}>
        {t("tk.composer.label")}
      </label>
      <textarea
        id="task-instruction"
        ref={box}
        rows={3}
        maxLength={INSTRUCTION_MAX}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          taskId.current = null;
        }}
        placeholder={t("tk.composer.placeholder")}
        className={fieldTextarea}
      />
      <div>
        <p className="text-sm font-semibold text-muted">{t("tk.composer.chips")}</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {templates.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                aria-pressed={picked === x.id}
                className={`${chip} ${picked === x.id ? "border-brand-edge bg-brand-bg text-brand-text" : "border-edge bg-surface text-ink"}`}
                onClick={() => {
                  setPicked(x.id);
                  setText((words[`tk.ex.${x.id}`] ?? x.example_instruction).slice(0, INSTRUCTION_MAX));
                  taskId.current = null;
                  box.current?.focus();
                }}
              >
                {words[`tk.t.${x.id}`] ?? x.label}
              </button>
            </li>
          ))}
        </ul>
        {promo ? (
          <p data-part="offer-note" className={`${mutedText} !mt-2`}>
            {t("tk.offer.note")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="task-language" className={fieldLabel}>
            {t("tk.composer.language")}
          </label>
          <select id="task-language" value={language} onChange={(e) => setLanguage(e.target.value as TaskLang | "auto")} className={fieldInput}>
            <option value="auto">{t("tk.composer.language.auto")}</option>
            {CALL_LANGS.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <details data-part="list">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand-text">{t("tk.composer.list")}</summary>
        <textarea aria-label={t("tk.composer.list")} rows={4} value={list} onChange={(e) => setList(e.target.value)} className={`${fieldTextarea} mt-1`} />
        <p className={mutedText}>{t("tk.composer.list.help")}</p>
        {parsed.people.length > 0 || parsed.skipped > 0 ? <p className={mutedText}>{t("tk.composer.list.count", { n: parsed.people.length, skipped: parsed.skipped })}</p> : null}
      </details>
      <button type="submit" className={btnMain} disabled={busy || text.trim().length < INSTRUCTION_MIN}>
        {busy ? t("tk.composer.working") : t("tk.composer.submit")}
      </button>
      <p className={`${mutedText} !mt-0`}>{t("tk.composer.note")}</p>
      {error ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {t(`tk.err.${error}`)}
        </p>
      ) : null}
    </form>
  );
}
