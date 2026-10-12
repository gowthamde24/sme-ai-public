import type { Template } from "@/lib/api/whatsapp";

import { card, h2, pillClass } from "../cc/kit";
import { dataTable, dataTd, dataThCol, dataTr } from "../ui";
import { makeT, type Words } from "../words";

/** The message templates (job CC, screen 5), read only: a template is what may be sent to a customer whose 24 hours are over, and only an approved one is ever used. Writing and sending them for review is not on this screen. */
export function TemplatesList({ words, items }: { words: Words; items: Template[] }) {
  const t = makeT(words);
  const tone = { draft: "neutral", submitted: "amber", approved: "green", rejected: "red", paused: "amber", disabled: "red" } as const;
  return (
    <section className={card} aria-labelledby="wa-templates-h" data-whatsapp="templates">
      <h2 id="wa-templates-h" className={h2}>
        {t("wa.tpl.title")}
      </h2>
      <p className="text-base text-muted">{t("wa.tpl.intro")}</p>
      {items.length === 0 ? (
        <p className="text-base text-muted">{t("wa.tpl.none")}</p>
      ) : (
        <table className={dataTable}>
          <thead>
            <tr>
              {["wa.tpl.col.name", "wa.tpl.col.language", "wa.tpl.col.purpose", "wa.tpl.col.status"].map((k) => (
                <th key={k} scope="col" className={dataThCol}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id} className={dataTr}>
                <td data-label={t("wa.tpl.col.name")} className={`${dataTd} break-words font-mono text-sm`}>
                  {x.name}
                </td>
                <td data-label={t("wa.tpl.col.language")} className={dataTd}>
                  {t(`today.lang.${x.language}`)}
                </td>
                <td data-label={t("wa.tpl.col.purpose")} className={dataTd}>
                  {["followup", "visit", "order_status", "info"].includes(x.purpose) ? t(`wa.tpl.purpose.${x.purpose}`) : x.purpose}
                </td>
                <td data-label={t("wa.tpl.col.status")} className={dataTd}>
                  <span className={pillClass(tone[x.status])}>{t(`wa.tpl.status.${x.status}`)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
