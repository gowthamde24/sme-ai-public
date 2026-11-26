import * as React from "react";

import { btnQuiet, fieldHelp, fieldInput } from "../../ui";
import type { Say } from "../../words";
import { NEVER, type Draft } from "./draft";

/** Words it must never say: an add / remove list (up to 30 words, 60 letters each). */
export function NeverSay({ t, d, set }: { t: Say; d: Draft; set: (p: Partial<Draft>) => void }) {
  const [word, setWord] = React.useState("");
  const full = d.neverSay.length >= NEVER.max;
  const add = () => {
    const w = word.trim().slice(0, NEVER.len);
    if (w === "" || full) return;
    if (!d.neverSay.some((x) => x.toLowerCase() === w.toLowerCase())) set({ neverSay: [...d.neverSay, w] });
    setWord("");
  };
  return (
    <section data-part="wiz-never" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <label htmlFor="wiz-never" className="m-0 text-base font-semibold text-ink">
        {t("emp.wiz.never.h")}
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <input
          id="wiz-never"
          type="text"
          value={word}
          maxLength={NEVER.len}
          disabled={full}
          aria-label={t("emp.wiz.never.label")}
          aria-describedby="wiz-never-d"
          placeholder={t("emp.wiz.never.label")}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className={`${fieldInput} min-w-0 flex-1`}
        />
        <button type="button" onClick={add} disabled={full || word.trim() === ""} className={btnQuiet}>
          {t("emp.wiz.never.add")}
        </button>
      </div>
      <p id="wiz-never-d" className={`${fieldHelp} m-0`}>
        {t("emp.wiz.never.hint", { len: NEVER.len })} {full ? t("emp.wiz.never.full") : t("emp.wiz.never.count", { n: d.neverSay.length, max: NEVER.max })}
      </p>
      {d.neverSay.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t("emp.wiz.never.empty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {d.neverSay.map((w) => (
            <li key={w} className="flex min-h-11 items-center gap-1 rounded-md border border-line bg-surface-2 pl-3 text-base">
              <span className="[overflow-wrap:anywhere]">{w}</span>
              <button type="button" aria-label={t("emp.wiz.never.remove", { word: w })} onClick={() => set({ neverSay: d.neverSay.filter((x) => x !== w) })} className="grid size-11 place-items-center rounded-md text-lg font-semibold text-muted hover:text-ink">
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
