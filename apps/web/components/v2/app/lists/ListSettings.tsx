"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { NAME_MAX, type Done, type SellList } from "@/lib/lists/types";

import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";

/**
 * "List settings" at the foot of a list (owner, 26 Nov 2026: a list could be made but not renamed or deleted from the screen): rename it, or delete it with its items after one plain confirmation. Owner and Admin only (the page does not draw it for others).
 * Deleting is two steps on purpose: the first press says what goes ("the list and its N items"), the second does it.
 */
export function ListSettings({ list, words, base, rename, remove }: { list: SellList; words: Words; base: string; rename: (name: string) => Promise<Done<SellList>>; remove: () => Promise<Done<true>> }) {
  const t = makeT(words);
  const router = useRouter();
  const [name, setName] = React.useState(list.name);
  const [busy, setBusy] = React.useState(false);
  const [sure, setSure] = React.useState(false);
  const [note, setNote] = React.useState<{ text: string; bad: boolean } | null>(null);
  const say = (code: string) => t(`wls.err.${code}` as "wls.err.unavailable");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() === "" || name.trim() === list.name) return;
    setBusy(true);
    const r = await rename(name.trim());
    setBusy(false);
    if (!r.ok) return setNote({ text: say(r.error), bad: true });
    setNote({ text: t("wls.settings.renamed"), bad: false });
    router.refresh();
  };
  const del = async () => {
    if (!sure) return setSure(true);
    setBusy(true);
    const r = await remove();
    if (r.ok) return router.push(base);
    setBusy(false);
    setSure(false);
    setNote({ text: say(r.error), bad: true });
  };
  return (
    <details data-part="list-settings" className="mt-8 border-t border-line pt-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-[15px] font-semibold text-muted [&::-webkit-details-marker]:hidden">{t("wls.settings.title")}</summary>
      <form onSubmit={(e) => void save(e)} className="mt-2 flex max-w-md flex-col gap-1">
        <label htmlFor="wls-rename" className={fieldLabel}>
          {t("wls.settings.rename")}
        </label>
        <div className="flex gap-2">
          <input id="wls-rename" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} className={`${fieldInput} flex-1`} />
          <button type="submit" disabled={busy || name.trim() === "" || name.trim() === list.name} className={btnQuiet}>
            {t("wls.save")}
          </button>
        </div>
      </form>
      <div className="mt-5 flex flex-col gap-2">
        {sure ? <p role="alert" className="m-0 text-[15px] font-semibold text-ink">{t("wls.settings.delete.sure", { name: list.name, n: list.rowCount })}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void del()} className={sure ? btnMain : btnQuiet}>
            {sure ? t("wls.settings.delete.yes") : t("wls.settings.delete")}
          </button>
          {sure ? (
            <button type="button" onClick={() => setSure(false)} className={btnQuiet}>
              {t("wls.cancel")}
            </button>
          ) : null}
        </div>
      </div>
      {note ? (
        <p role={note.bad ? "alert" : "status"} className="m-0 mt-3 text-[15px] font-semibold text-ink">
          {note.text}
        </p>
      ) : null}
    </details>
  );
}
