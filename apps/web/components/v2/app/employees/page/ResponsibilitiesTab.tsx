"use client";

import * as React from "react";

import { RESPONSIBILITIES } from "@/lib/employees/types";

import { Tick } from "../../ds/Tick";
import { makeT } from "../../words";
import { Card, SaveBar, same, useSave, type TabProps } from "./shared";

/** Responsibilities: the nine jobs it can do, as a checklist. An id this screen does not know (a newer one) is kept as it is. Also for the main assistant. */
export function ResponsibilitiesTab({ emp, words, canEdit, actions, onChange }: TabProps) {
  const t = makeT(words);
  const known = new Set<string>(RESPONSIBILITIES);
  const extra = emp.responsibilities.filter((r) => !known.has(r));
  const [picked, setPicked] = React.useState<string[]>(emp.responsibilities.filter((r) => known.has(r)));
  const save = useSave(onChange);
  const next = [...RESPONSIBILITIES.filter((r) => picked.includes(r)), ...extra];
  const changed = !same([...next].sort(), [...emp.responsibilities].sort());
  return (
    <Card title={t("emp.page.resp")} desc={t("emp.page.resp_help")}>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">{t("emp.page.resp")}</legend>
        {RESPONSIBILITIES.map((r) => (
          <Tick key={r} label={t(`emp.resp.${r}`)} checked={picked.includes(r)} disabled={!canEdit} onChange={(e) => (save.clear(), setPicked((p) => (e.target.checked ? [...p, r] : p.filter((x) => x !== r))))} />
        ))}
      </fieldset>
      {canEdit ? <SaveBar words={words} state={save} onSave={() => void save.run(() => actions.patch({ responsibilities: next }))} disabled={!changed} /> : null}
    </Card>
  );
}
