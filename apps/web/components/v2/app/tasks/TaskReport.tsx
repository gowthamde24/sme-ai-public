import { formatRupeesShort } from "@/lib/money";
import type { ReportOut, TaskOut } from "@/lib/tasks/types";

import { mutedText, pillAmber, pillGreen, pillNeutral, pillRed, surface, table, tableWrap, td, th } from "../ui";
import { makeT, type Words } from "../words";
import { capturedText, codeText } from "./task-format";

const OUTCOME_PILL: Record<string, string> = { positive: pillGreen, negative: pillNeutral, unclear: pillAmber, no_answer: pillNeutral, failed: pillRed, skipped: pillNeutral };

/**
 * The REPORT of a task (night 4, job DR part B): the short answer first and big ("Cheapest: Sri Venkateswara Traders ₹395/bag, delivery Thursday"), then the totals, then one row per person with the outcome, what was captured, the message
 * status and the transcript in a closed `details` (always marked simulated: no real call was made). Plain text only: every sentence and every transcript line comes from the API and is drawn as text, in the task's language (`lang`
 * is set on it). No hooks: a server page and the Ask thread both draw it.
 */
export function TaskReport({ report, task, words }: { report: ReportOut; task: Pick<TaskOut, "language" | "plan">; words: Words }) {
  const t = makeT(words);
  const amountKeys = new Set((task.plan?.questions ?? []).filter((q) => q.type === "amount").map((q) => q.key));
  const totals = report.totals;
  const cells: [string, number][] = [
    ["tk.r.t.contacts", totals.contacts],
    ["tk.r.t.reached", totals.reached],
    ["tk.r.t.positive", totals.positive],
    ["tk.r.t.negative", totals.negative],
    ["tk.r.t.unclear", totals.unclear],
    ["tk.r.t.no_answer", totals.no_answer],
  ];
  return (
    <section data-part="report" aria-labelledby="task-report-h" className="flex flex-col gap-4">
      <div className={`${surface} flex flex-col gap-2`}>
        <h2 id="task-report-h" className="text-sm font-semibold text-muted">
          {t("tk.r.title")}
        </h2>
        <p data-part="short-answer" lang={task.language} className="font-display text-2xl font-bold leading-snug [overflow-wrap:anywhere] md:text-3xl">
          {report.short_answer}
        </p>
        <p className={`${mutedText} !mt-0`}>
          <span data-part="simulated">{t("tk.r.simulated")}</span> {t("tk.r.draft")}
        </p>
      </div>
      <dl data-part="totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {cells.map(([key, n]) => (
          <div key={key} className="rounded-xl border border-line bg-surface p-3">
            <dt className="text-sm font-semibold text-muted">{t(key)}</dt>
            <dd className="font-display text-2xl font-bold">{n}</dd>
          </div>
        ))}
        <div className="rounded-xl border border-line bg-surface p-3">
          <dt className="text-sm font-semibold text-muted">{t("tk.r.t.spent")}</dt>
          <dd className="font-display text-2xl font-bold">{formatRupeesShort(totals.spent_paise)}</dd>
        </div>
      </dl>
      {report.rows.length === 0 ? (
        <p className={`${mutedText} !mt-0`}>{t("tk.r.empty")}</p>
      ) : (
        <div className={`${tableWrap} !mt-0`}>
          <table className={table} data-part="rows">
            <caption className="sr-only">{t("tk.r.table")}</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  {t("tk.r.h.name")}
                </th>
                <th scope="col" className={th}>
                  {t("tk.r.h.phone")}
                </th>
                <th scope="col" className={th}>
                  {t("tk.r.h.outcome")}
                </th>
                <th scope="col" className={th}>
                  {t("tk.r.h.captured")}
                </th>
                <th scope="col" className={th}>
                  {t("tk.r.h.message")}
                </th>
                <th scope="col" className={th}>
                  {t("tk.r.h.transcript")}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const captured = capturedText(row, amountKeys);
                return (
                  <tr key={row.contact_id} data-outcome={row.outcome}>
                    <th scope="row" className={`${td} font-semibold [overflow-wrap:anywhere]`}>
                      {row.name}
                    </th>
                    <td className={td}>{row.phone_last4 ? `…${row.phone_last4}` : ""}</td>
                    <td className={td}>
                      <span className={OUTCOME_PILL[row.outcome] ?? pillNeutral}>{codeText(t, "tk.o", row.outcome)}</span>
                      {row.category && codeText(t, "tk.cat", row.category) !== codeText(t, "tk.o", row.outcome) ? <span className="mt-1 block text-sm text-muted">{codeText(t, "tk.cat", row.category)}</span> : null}
                    </td>
                    <td className={`${td} [overflow-wrap:anywhere]`} lang={task.language}>
                      {captured.length === 0 ? (
                        <span className="text-muted">{t("tk.r.none")}</span>
                      ) : (
                        <ul>
                          {captured.map((c) => (
                            <li key={c.key}>
                              <span className="text-sm text-muted">{c.key}: </span>
                              {c.value}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={td}>{row.message_status ? codeText(t, "tk.ms", row.message_status) : ""}</td>
                    <td className={td}>
                      {row.transcript && row.transcript.length > 0 ? (
                        <details>
                          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand-text">{t("tk.r.transcript")}</summary>
                          <ul className="mt-1 flex min-w-[16rem] flex-col gap-1" lang={task.language}>
                            {row.transcript.map((line, i) => (
                              <li key={i} className="[overflow-wrap:anywhere]">
                                <span className="text-sm font-semibold text-muted">{t(line.who === "assistant" ? "tk.r.who.assistant" : "tk.r.who.contact")}: </span>
                                {line.text}
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1 text-sm text-muted">{t("tk.r.simulated")}</p>
                        </details>
                      ) : (
                        <span className="text-muted">{t("tk.r.notranscript")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
