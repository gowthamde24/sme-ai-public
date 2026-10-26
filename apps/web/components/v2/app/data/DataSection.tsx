import { LocalTime } from "@/app/app/local-time";
import type { CalendarFeed as Feed, ExportFormat, ImportJob, NewCalendarFeed } from "@/lib/api/data";
import type { Part } from "@/lib/api/part";

import { card, h2, type Failed } from "../cc/kit";
import { PartProblem } from "../cc/PartProblem";
import { makeT, type Words } from "../words";
import { dataTable, dataTd, dataThCol, dataTr, mutedText } from "../ui";
import { CalendarFeed, DataExport, DataImport } from "../settings/LazyTabs";

type FeedResult = { ok: true; feed: NewCalendarFeed } | Failed;

/**
 * The "Data" part of Settings (job CC, screen 1). Everyone sees the calendar address; the import, the export and the list of recent imports are for the Owner and Admin. Each part was read on its own: one that could not
 * be read says so in its place (refused, too many tries, or not loaded) and the rest works.
 */
export function DataSection({ tenantId, words, admin, formats, jobs, feed, makeFeed, revokeFeed }: { tenantId: string; words: Words; admin: boolean; formats: Part<ExportFormat[]> | null; jobs: Part<ImportJob[]> | null; feed: Part<Feed>; makeFeed: () => Promise<FeedResult>; revokeFeed: () => Promise<{ ok: true } | Failed> }) {
  const t = makeT(words);
  return (
    <div className="flex flex-col gap-5" data-settings="data">
      <p className={mutedText}>{t("dta.intro")}</p>
      {admin ? (
        <>
          <DataImport tenantId={tenantId} words={words} />
          {jobs ? <Jobs jobs={jobs} words={words} /> : null}
          {formats?.ok ? <DataExport tenantId={tenantId} words={words} formats={formats.data} /> : formats ? <PartProblem kind={formats.kind} retryAfter={formats.retryAfter} words={words} title={t("dta.export.title")} /> : null}
        </>
      ) : (
        <p className="text-base text-muted">{t("dta.admin_only")}</p>
      )}
      {feed.ok ? <CalendarFeed words={words} feed={feed.data} make={makeFeed} revoke={revokeFeed} /> : <PartProblem kind={feed.kind} retryAfter={feed.retryAfter} words={words} title={t("dta.cal.title")} />}
    </div>
  );
}

function Jobs({ jobs, words }: { jobs: Part<ImportJob[]>; words: Words }) {
  const t = makeT(words);
  if (!jobs.ok) return <PartProblem kind={jobs.kind} retryAfter={jobs.retryAfter} words={words} title={t("dta.jobs.title")} />;
  return (
    <section className={card} aria-labelledby="dta-jobs-h">
      <h2 id="dta-jobs-h" className={h2}>
        {t("dta.jobs.title")}
      </h2>
      {jobs.data.length === 0 ? (
        <p className="text-base text-muted">{t("dta.jobs.empty")}</p>
      ) : (
        <table className={dataTable}>
          <thead>
            <tr>
              <th scope="col" className={dataThCol}>
                {t("dta.import.title")}
              </th>
              <th scope="col" className={dataThCol}>
                {t("dta.col.result")}
              </th>
              <th scope="col" className={dataThCol}>
                {t("dta.cal.made")}
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.data.map((j) => (
              <tr key={j.id} className={dataTr}>
                <td data-label={t("dta.import.title")} className={dataTd}>
                  {t(`dta.kind.${j.kind}`)}
                </td>
                <td data-label={t("dta.col.result")} className={dataTd}>
                  {t(`dta.jobs.${j.status}`)}
                </td>
                <td data-label={t("dta.cal.made")} className={dataTd}>
                  {j.created_at ? <LocalTime iso={j.created_at} /> : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
