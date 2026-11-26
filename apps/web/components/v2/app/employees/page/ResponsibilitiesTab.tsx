"use client";

import * as React from "react";

import Link from "next/link";

import { CHANNEL_RESPONSIBILITIES, RESPONSIBILITIES } from "@/lib/employees/types";

import { Tick } from "../../ds/Tick";
import { makeT } from "../../words";
import { Card, SaveBar, same, useSave, type TabProps } from "./shared";

/** Responsibilities: the nine jobs it can do, as a checklist. An id this screen does not know (a newer one) is kept as it is. Also for the main assistant. */
export function ResponsibilitiesTab({ emp, words, canEdit, actions, onChange, base }: TabProps) {
  const t = makeT(words);
  const all: readonly string[] = [...CHANNEL_RESPONSIBILITIES, ...RESPONSIBILITIES];
  const known = new Set<string>(all);
  const extra = emp.responsibilities.filter((r) => !known.has(r));
  const [picked, setPicked] = React.useState<string[]>(emp.responsibilities.filter((r) => known.has(r)));
  const save = useSave(onChange);
  const next = [...all.filter((r) => picked.includes(r)), ...extra];
  const changed = !same([...next].sort(), [...emp.responsibilities].sort());
  return (
    <Card title={t("emp.page.resp")} desc={t("emp.page.resp_help")}>
      <fieldset className="m-0 mb-4 min-w-0 border-0 p-0" data-part="channels">
        <legend className="mb-1 text-[15px] font-semibold text-ink">{t("emp.channels.h")}</legend>
        {CHANNEL_RESPONSIBILITIES.map((r) => (
          <Tick key={r} label={t(`emp.resp.${r}`)} checked={picked.includes(r)} disabled={!canEdit} onChange={(e) => (save.clear(), setPicked((p) => (e.target.checked ? [...p, r] : p.filter((x) => x !== r))))} />
        ))}
        {picked.includes("channel_whatsapp") && (emp.needs.length > 0 || !emp.channels.whatsapp) ? (
          <p data-part="wa-needs" className="m-0 mt-1 text-sm text-muted">
            {t("emp.channels.wa_needs")}{" "}
            <Link href={`${base}/integrations/whatsapp`} prefetch={false} className="font-semibold text-brand-text underline underline-offset-2">
              {t("emp.channels.wa_connect")}
            </Link>
          </p>
        ) : null}
      </fieldset>
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
