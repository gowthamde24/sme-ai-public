"use client";

import { useId, useState } from "react";

import { gstinProblem, normaliseGstin, stateOfGstin } from "@/lib/gstin";

import { FailureNote } from "../cc/FailureNote";
import { card, field, h2, help, label as labelClass, okLine, primary, quiet, type Failed } from "../cc/kit";
import { makeT, type Words } from "../words";

export type SavedGstin = { gstin: string | null; state: string | null };
export type GstinSave = (gstin: string | null) => Promise<{ ok: true; data: SavedGstin } | Failed>;

/**
 * A GSTIN to read and, for those who may, to change (job CC, screen 6): the shop's own (Settings > Business) and a business customer's (the company page). The number is checked for FORM as it is typed (length, shape, the check
 * character): a number that is not well formed is not sent. Spaces, dashes and small letters are fine. The state is named from the first two digits. Nothing here says the business exists or is active: the page says so in words.
 * `bare` draws it as part of a page; without it, as a card of its own.
 */
export function GstinForm({ words, title, intro, personal, initial, canEdit, save, bare = false, needsSecondStep = false }: { words: Words; title: string; intro?: string; personal?: boolean; initial: SavedGstin; canEdit: boolean; save: GstinSave; bare?: boolean; needsSecondStep?: boolean }) {
  const t = makeT(words);
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial.gstin ?? "");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const problem = gstinProblem(text);
  const typed = normaliseGstin(text);
  const changed = typed !== (saved.gstin ?? "");

  async function run(kind: "save" | "clear") {
    setFailure(null);
    setSaid(null);
    if (kind === "save" && (problem || typed === "")) return;
    setBusy(kind);
    const r = await save(kind === "clear" ? null : typed);
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setSaved(r.data);
    setText(r.data.gstin ?? "");
    setSaid(t(r.data.gstin ? "gst.saved" : "gst.cleared"));
  }
  const own = (code: string) => (code === "validation_error" ? t("gst.bad.shape") : null);
  const inner = (
    <>
      <h2 id={`${id}-h`} className={h2}>
        {title}
      </h2>
      {intro ? <p className="text-base text-muted">{intro}</p> : null}
      {saved.gstin ? (
        <p className="text-base" data-gstin="">
          <span className="font-mono text-lg font-semibold [overflow-wrap:anywhere]">{saved.gstin}</span>
          {(saved.state ?? stateOfGstin(saved.gstin)) ? <span className="block text-sm text-muted">{t("gst.state", { state: saved.state ?? stateOfGstin(saved.gstin) ?? "" })}</span> : null}
        </p>
      ) : (
        <p className="text-base text-muted">{t("gst.none")}</p>
      )}
      {canEdit ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run("save");
          }}
        >
          <div>
            <label htmlFor={`${id}-in`} className={labelClass}>
              {t("gst.label")}
            </label>
            <input id={`${id}-in`} value={text} onChange={(e) => setText(e.target.value)} maxLength={30} autoComplete="off" spellCheck={false} aria-invalid={problem ? true : undefined} aria-describedby={`${id}-hint`} className={`${field} font-mono uppercase`} />
            <p id={`${id}-hint`} className={help}>
              {t("gst.hint")}
            </p>
            {problem && typed !== "" ? (
              <p role="alert" className="mt-1 text-sm font-medium text-red-text">
                {t(`gst.bad.${problem}`)}
              </p>
            ) : null}
            {!problem && typed !== "" && changed && stateOfGstin(typed) ? <p className={help}>{t("gst.state", { state: stateOfGstin(typed) ?? "" })}</p> : null}
          </div>
          {personal ? <p className={help}>{t("gst.personal")}</p> : null}
          <p className={help}>{t("gst.only_form")}</p>
          {needsSecondStep ? <p className={help}>{t("gst.mfa")}</p> : null}
          <FailureNote failure={failure} words={words} own={own} />
          {said ? (
            <p role="status" className={okLine}>
              {said}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy !== null || !changed || typed === "" || problem !== null} className={primary}>
              {busy === "save" ? t("dta.btn.working") : t("gst.save")}
            </button>
            {saved.gstin ? (
              <button type="button" onClick={() => run("clear")} disabled={busy !== null} className={quiet}>
                {busy === "clear" ? t("dta.btn.working") : t("gst.clear")}
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className={help}>{t("gst.read_only")}</p>
      )}
    </>
  );
  return bare ? (
    <div className="flex flex-col gap-3" aria-labelledby={`${id}-h`} role="group" data-gstin-form="">
      {inner}
    </div>
  ) : (
    <section className={card} aria-labelledby={`${id}-h`} data-gstin-form="">
      {inner}
    </section>
  );
}
