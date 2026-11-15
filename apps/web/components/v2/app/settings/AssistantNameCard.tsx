"use client";

import { useState } from "react";

import { btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, alertBox, okBox } from "../ui";
import { makeT, type Words } from "../words";

export type RenameFn = (name: string | null) => Promise<{ ok: true; name: string | null } | { ok: false; error: "invalid" | "not_available" | "read_only" }>;

/**
 * The assistant's name on the Settings home (owner 15 Nov): the field itself, so nobody has to find "AI assistant" first. Save changes the name; "Use 'your assistant'" removes it (blank = no name). What was there before can be put back with Undo
 * (the same call with the earlier name). Nothing else about the assistant changes here. `rename` is the server action bound to the workspace.
 */
export function AssistantNameCard({ words, name, rename }: { words: Words; name: string | null; rename: RenameFn }) {
  const t = makeT(words);
  const [current, setCurrent] = useState<string | null>(name);
  const [text, setText] = useState(name ?? "");
  const [before, setBefore] = useState<{ name: string | null } | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "saved" | "undone" | "invalid" | "failed" | "read_only">("idle");

  const apply = async (next: string | null, undo = false) => {
    setState("busy");
    const out = await rename(next).catch((): { ok: false; error: "not_available" } => ({ ok: false, error: "not_available" }));
    if (!out.ok) {
      setState(out.error === "invalid" ? "invalid" : out.error === "read_only" ? "read_only" : "failed");
      return;
    }
    setBefore(undo ? null : { name: current });
    setCurrent(out.name);
    setText(out.name ?? "");
    setState(undo ? "undone" : "saved");
  };

  const same = text.trim() === (current ?? "");
  return (
    <div data-part="assistant-name" className="mt-3 flex flex-col gap-3">
      <p className="text-base text-muted">{t("sv6.asst.text")}</p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!same) void apply(text.trim() === "" ? null : text.trim());
        }}
      >
        <label htmlFor="sv6-asst-name" className={fieldLabel}>
          {t("sv6.asst.label")}
        </label>
        <input id="sv6-asst-name" value={text} onChange={(e) => (setText(e.target.value), setState("idle"))} maxLength={24} autoComplete="off" placeholder={t("sv6.asst.placeholder")} disabled={state === "busy"} className={fieldInput} />
        <p className={`${fieldHelp} !mt-0`}>{current ? t("sv6.asst.now", { name: current }) : t("sv6.asst.none")}</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={btnMain} disabled={state === "busy" || same}>
            {t("sv6.asst.save")}
          </button>
          {current ? (
            <button type="button" className={btnQuiet} disabled={state === "busy"} onClick={() => void apply(null)}>
              {t("sv6.asst.remove")}
            </button>
          ) : null}
        </div>
      </form>
      {state === "saved" || state === "undone" ? (
        <p role="status" className={`${okBox} !mt-0 flex flex-wrap items-center justify-between gap-2`}>
          <span>{state === "undone" ? t("sv6.asst.undone") : current ? t("sv6.asst.saved", { name: current }) : t("sv6.asst.removed")}</span>
          {state === "saved" && before ? (
            <button type="button" className={btnQuiet} onClick={() => void apply(before.name, true)}>
              {t("sv6.asst.undo")}
            </button>
          ) : null}
        </p>
      ) : null}
      {state === "invalid" || state === "failed" || state === "read_only" ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {t(state === "invalid" ? "sv6.asst.invalid" : state === "read_only" ? "pc.err.read_only" : "sv6.asst.failed")}
        </p>
      ) : null}
    </div>
  );
}
