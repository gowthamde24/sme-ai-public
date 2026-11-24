"use client";

import { CITIES, type City } from "@/lib/phone-number/types";

import { SelectField } from "../settings/simple/fields";
import { Choose, Sentence } from "../jobs/rules/parts";
import { EffectLine } from "../jobs/pages/parts";
import { btnMain, fieldHelp } from "../ui";
import { makeT, type Words } from "../words";

/**
 * "Get a number" under JOBS (the simplicity pass): one sentence with the city inside ("Get a number in [Hyderabad]."), the one line that says what it costs (money every month; the price is shown and a yes is needed before anything is bought: no price is made up here),
 * what will happen in one live line, and ONE main button. Same cities, same request as the chips and the button of before; only the owner changes anything.
 */
export function PhoneGetSimple({ words, city, canEdit, busy, onCity, onGet, plain = false }: { plain?: boolean; words: Words; city: City; canEdit: boolean; busy: boolean; onCity: (c: City) => void; onGet: () => void }) {
  const t = makeT(words);
  const name = (c: string) => t(`phone.city.${c}` as "phone.city.hyderabad");
  if (plain) {
    return (
      <div className="flex max-w-md flex-col gap-4" data-part="phone-pick" data-simple="" data-plain="">
        <SelectField label={t("phone.city.title")} hint={t("phone.cost")} value={city} options={CITIES.map((c) => ({ value: c, label: name(c) }))} onChange={(v) => onCity(v as City)} disabled={!canEdit || busy} />
        <p className="m-0 text-[14px] text-muted" data-part="phone-effect">
          {t("jobs.pg.phone.effect", { city: name(city) })}
        </p>
        {canEdit ? (
          <div>
            <button type="button" disabled={busy} onClick={onGet} className={btnMain}>
              {t("phone.get")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-part="phone-pick" data-simple="">
      <Sentence line="phone-city" template={t("jobs.pg.phone.line")} parts={{ city: () => <Choose aria={t("phone.city.title")} value={city} options={CITIES} text={name} disabled={!canEdit || busy} onChange={(v) => onCity(v as City)} /> }} />
      <p className={`${fieldHelp} !mt-0`} data-part="phone-cost">
        {t("phone.cost")}
      </p>
      <EffectLine part="phone-effect" label={t("jobs.pg.phone.effect.label")} text={t("jobs.pg.phone.effect", { city: name(city) })} />
      {canEdit ? (
        <div>
          <button type="button" disabled={busy} onClick={onGet} className={btnMain}>
            {t("phone.get")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
