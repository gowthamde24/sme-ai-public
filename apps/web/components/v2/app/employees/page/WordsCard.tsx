"use client";

import * as React from "react";

import { INSTRUCTIONS_MAX, NEVER_SAY_LEN, NEVER_SAY_MAX } from "@/lib/employees/types";

import { btnQuiet, fieldHelp, fieldInput, fieldLabel } from "../../ui";
import { makeT } from "../../words";
import { Card, SaveBar, same, useSave, type TabProps } from "./shared";

/** Words it must never say: up to 30, each up to 60 letters, one at a time. Also for the main assistant. */
export function NeverSayCard({ emp, words, canEdit, actions, onChange }: TabProps) {
  const t = makeT(words);
  const [list, setList] = React.useState<string[]>([...emp.neverSay]);
  const [typed, setTyped] = React.useState("");
  const save = useSave(onChange);
  const word = typed.trim();
  const full = list.length >= NEVER_SAY_MAX;
  const add = () => {
    if (word === "" || full) return;
    save.clear();
    setList((p) => (p.some((w) => w.toLowerCase() === word.toLowerCase()) ? p : [...p, word]));
    setTyped("");
  };
  return (
    <Card title={t("emp.page.never")} desc={t("emp.page.never_help", { max: NEVER_SAY_MAX })}>
      {list.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-part="emp-never-list">
          {list.map((w) => (
            <li key={w} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface-2 pl-3 text-[15px] text-ink">
              <span className="break-all">{w}</span>
              {canEdit ? (
                <button type="button" aria-label={t("emp.page.never.remove", { word: w })} onClick={() => (save.clear(), setList((p) => p.filter((x) => x !== w)))} className="inline-flex size-11 items-center justify-center rounded-full text-lg font-bold text-muted hover:text-ink">
                  <span aria-hidden="true">×</span>
                </button>
              ) : (
                <span className="pr-3" />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[15px] text-muted">{t("emp.page.never.none")}</p>
      )}
      {canEdit ? (
        <>
          <div>
            <label htmlFor="emp-never-add" className={fieldLabel}>
              {t("emp.page.never.add")}
            </label>
            <div className="flex gap-2">
              <input id="emp-never-add" type="text" value={typed} maxLength={NEVER_SAY_LEN} disabled={full} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} className={fieldInput} />
              <button type="button" onClick={add} disabled={word === "" || full} data-part="emp-never-add" className={btnQuiet}>
                {t("emp.page.never.add_btn")}
              </button>
            </div>
            <p className={fieldHelp}>{t("emp.page.never.count", { n: list.length, max: NEVER_SAY_MAX, len: NEVER_SAY_LEN })}</p>
          </div>
          <SaveBar words={words} state={save} onSave={() => void save.run(() => actions.patch({ neverSay: list }))} disabled={same(list, emp.neverSay)} />
        </>
      ) : null}
    </Card>
  );
}

/** Extra instructions in the owner's own words, with a live counter against the 1,500 limit. Also for the main assistant. */
export function InstructionsCard({ emp, words, canEdit, actions, onChange }: TabProps) {
  const t = makeT(words);
  const [text, setText] = React.useState(emp.extraInstructions ?? "");
  const save = useSave(onChange);
  const over = text.length > INSTRUCTIONS_MAX;
  const empty = text.trim() === "";
  const changed = text !== (emp.extraInstructions ?? "") && !(empty && emp.extraInstructions === null);
  return (
    <Card title={t("emp.page.instr")} desc={t("emp.page.instr_help")}>
      <div>
        <label htmlFor="emp-instr" className="sr-only">
          {t("emp.page.instr")}
        </label>
        <textarea id="emp-instr" rows={6} value={text} disabled={!canEdit} aria-describedby="emp-instr-count" onChange={(e) => (setText(e.target.value), save.clear())} className={`${fieldInput} py-2`} />
        <p id="emp-instr-count" aria-live="polite" data-part="emp-instr-count" className={`${fieldHelp} ${over ? "font-semibold text-red-text" : ""}`}>
          {t("emp.page.instr.count", { n: text.length, max: INSTRUCTIONS_MAX })}
        </p>
      </div>
      {canEdit ? <SaveBar words={words} state={save} onSave={() => void save.run(() => actions.patch({ extraInstructions: empty ? null : text }))} disabled={!changed || over} /> : null}
    </Card>
  );
}
