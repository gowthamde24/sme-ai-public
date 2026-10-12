import Link from "next/link";

import { CHANNELS, type ConsentList as List } from "@/lib/api/consent-list";

import { card, h2, h3, pillClass } from "../cc/kit";
import { dataTable, dataTd, dataThCol, dataTr } from "../ui";
import { makeT, type Words } from "../words";

const channelName = (t: ReturnType<typeof makeT>, ch: string) => (ch === "whatsapp" ? "WhatsApp" : t(`prx.consent.channel.${ch}`));
const REASONS = ["opted_out", "bounced", "complained", "legal", "manual"] as const;

/**
 * Settings > Privacy > "Consent and opt-out list" (job CC, screen 2): who has asked us to stop, and how many customers have agreed to each way of reaching them. It only shows what is recorded; to change it a person opens the
 * contact's own consent page (a withdrawn consent is never turned back on from here). The sentences are ours and stay in English until a person reviews them (they are consent statements).
 */
export function ConsentListView({ tenantId, words, list }: { tenantId: string; words: Words; list: List }) {
  const t = makeT(words);
  return (
    <section className={card} aria-labelledby="prx-consent-h" data-privacy="consent">
      <h2 id="prx-consent-h" className={h2}>
        {t("prx.consent.title")}
      </h2>
      <p className="text-base text-muted">{t("prx.consent.intro")}</p>
      {list.checked === 0 ? (
        <p className="text-base text-muted">{t("prx.consent.none_contacts")}</p>
      ) : (
        <>
          <dl className="grid gap-2 sm:grid-cols-3">
            {CHANNELS.map((ch) => (
              <div key={ch} className="rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-sm font-semibold text-muted">{channelName(t, ch)}</dt>
                <dd className="text-base">
                  {t("prx.consent.counts", { granted: list.counts[ch].granted, unknown: list.counts[ch].unknown, withdrawn: list.counts[ch].withdrawn })}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">{list.truncated ? t("prx.consent.first", { n: list.checked }) : t("prx.consent.all", { n: list.checked })}</p>
          <h3 className={h3}>{t("prx.consent.stopped")}</h3>
          {list.stopped.length === 0 ? (
            <p className="text-base text-muted">{t("prx.consent.stopped_none")}</p>
          ) : (
            <table className={dataTable}>
              <thead>
                <tr>
                  <th scope="col" className={dataThCol}>
                    {t("dta.col.name")}
                  </th>
                  <th scope="col" className={dataThCol}>
                    {t("prx.consent.col.list")}
                  </th>
                  <th scope="col" className={dataThCol}>
                    {t("prx.consent.col.channels")}
                  </th>
                  <th scope="col" className={dataThCol}>
                    <span className="sr-only">{t("prx.consent.col.open")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.stopped.map((c) => (
                  <tr key={c.id} className={dataTr}>
                    <td data-label={t("dta.col.name")} className={`${dataTd} break-words font-medium`}>
                      {c.name}
                    </td>
                    <td data-label={t("prx.consent.col.list")} className={dataTd}>
                      {c.reason ? <span className={pillClass("red")}>{(REASONS as readonly string[]).includes(c.reason) ? t(`prx.consent.reason.${c.reason}`) : t("prx.consent.reason.manual")}</span> : <span className="text-muted">{t("prx.consent.not_on_list")}</span>}
                    </td>
                    <td data-label={t("prx.consent.col.channels")} className={dataTd}>
                      <span className="flex flex-wrap gap-1">
                        {CHANNELS.filter((ch) => c.channels[ch] === "withdrawn").map((ch) => (
                          <span key={ch} className={pillClass("amber")}>
                            {t("prx.consent.withdrawn_on", { channel: channelName(t, ch) })}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td data-label="" className={dataTd}>
                      <Link href={`/app/tenants/${tenantId}/contacts/${c.id}/consent`} aria-label={`${t("prx.consent.open")} ${c.name}`} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">
                        {t("prx.consent.open")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
