"use client";

import * as React from "react";

import { Radio } from "../../ds/Tick";
import { makeT } from "../../words";
import { Card, SaveBar, useSave, type LineChoice, type TabProps } from "./shared";

/**
 * Phone: the workspace's lines; pick the one this AI employee answers, or None. A line has one employee; a line with none goes to the main assistant. The main assistant answers every line that has no employee, so it has nothing to pick.
 */
export function PhoneTab({ emp, words, canEdit, actions, onChange, lines, takenBy }: TabProps & { lines: readonly LineChoice[] | null; takenBy: Readonly<Record<string, string>> }) {
  const t = makeT(words);
  const [pick, setPick] = React.useState<string | null>(emp.phoneNumberId);
  const save = useSave(onChange);
  if (emp.isDefault) {
    return (
      <Card title={t("emp.page.phone")}>
        <p className="m-0 text-base text-ink" data-part="emp-phone-default">
          {t("emp.page.phone.default")}
        </p>
      </Card>
    );
  }
  const choose = (id: string | null) => {
    save.clear();
    setPick(id);
  };
  return (
    <Card title={t("emp.page.phone")} desc={t("emp.page.phone.help")}>
      {lines && lines.length > 0 ? (
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="sr-only">{t("emp.page.phone")}</legend>
          <Radio name="emp-phone" label={t("emp.page.phone.none")} sub={t("emp.page.phone.none_help")} checked={pick === null} disabled={!canEdit} onChange={() => choose(null)} />
          {lines.map((l) => {
            const other = takenBy[l.id];
            return <Radio key={l.id} name="emp-phone" label={l.display} sub={other ? t("emp.page.phone.taken", { name: other }) : undefined} checked={pick === l.id} disabled={!canEdit || Boolean(other)} onChange={() => choose(l.id)} />;
          })}
        </fieldset>
      ) : (
        <p className="m-0 text-base text-ink" data-part="emp-phone-none">
          {t("emp.page.phone.no_lines")}
        </p>
      )}
      {canEdit && lines && lines.length > 0 ? <SaveBar words={words} state={save} onSave={() => void save.run(() => actions.setPhone(pick))} disabled={pick === emp.phoneNumberId} /> : null}
    </Card>
  );
}
