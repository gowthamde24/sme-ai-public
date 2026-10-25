import { AgentMark } from "../mark/AgentMark";
import { word, type Labels } from "../labels";
import { bodyText, mutedText, pageH1, surface, warnBox } from "../ui";
import { weekdayWord } from "../date-words";
import { dayShort } from "../visits/dates";
import { fillClass } from "../frame-parts";
import { BarRow, DayColumns } from "./Bars";
import type { ReportData } from "@/lib/report/week";

const h2 = "font-display text-xl font-bold leading-tight";

/** "12 min" or "1 h 5 min": time in words of the person's language, from whole minutes. */
export function minutesText(labels: Labels, minutes: number): string {
  if (minutes < 60) return word(labels, "report.response.min", "{n} min", { n: minutes });
  return word(labels, "report.response.hours", "{h} h {m} min", { h: Math.floor(minutes / 60), m: minutes % 60 });
}

function unmatchedText(labels: Labels, n: number): string {
  return n === 1 ? word(labels, "report.sarees.unmatched.one", "1 sent message had photos we could not match to a saree in your catalogue.") : word(labels, "report.sarees.unmatched", "{n} sent messages had photos we could not match to a saree in your catalogue.", { n });
}

function Unreadable({ labels }: { labels: Labels }) {
  return (
    <p role="status" className={warnBox}>
      {word(labels, "report.error", "Could not read this part. Reload the page to try again.")}
    </p>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <AgentMark px={56} mood={"resting"} className="size-14 shrink-0" />
      <p className="text-base text-muted">{text}</p>
    </div>
  );
}

/**
 * "This week" (job BV): the owner's week at a glance, from `readReport`. Every number is a real count from the API; a part that could not be read says so in its own card and never draws a zero. Bars carry their number
 * in words beside the name, so no figure depends on colour or length alone; the charts are plain CSS and work at 360 px. No money and no customer's name appears here.
 */
export function ReportView({ data, labels, lang, catalogue = true, more = null }: { data: ReportData; labels: Labels; lang: string; /** The business keeps a catalogue (a business without one has no "sent most" card). */ catalogue?: boolean; /** The pack's own reports (job CU): drawn after the week. */ more?: React.ReactNode }) {
  const { range } = data;
  const rangeText = word(labels, "report.range", "{from} to {to}", { from: dayShort(range.from, lang), to: dayShort(range.to, lang) });
  const days = Array.from({ length: 7 }, (_, i) => weekdayWord(lang, i, "short"));
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className={pageH1}>{word(labels, "report.title", "This week")}</h1>
        <p className="text-lg font-semibold">{rangeText}</p>
        <p className={mutedText}>{word(labels, "report.intro", "What happened in your shop this week, Monday to Sunday, from the records you and Agent OWL keep.")}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="rp-visits" className={surface}>
          <h2 id="rp-visits" className={h2}>
            {word(labels, "report.visits.title", "Store visits")}
          </h2>
          {data.visits === "error" ? (
            <Unreadable labels={labels} />
          ) : data.visits.booked === 0 && data.visits.cancelled === 0 ? (
            <Empty text={word(labels, "report.visits.empty", "No visits booked this week yet.")} />
          ) : (
            <>
              <ul className="mt-4 flex flex-col gap-4">
                <BarRow label={word(labels, "report.visits.booked", "Booked")} value={data.visits.booked} max={data.visits.booked} />
                <BarRow label={word(labels, "report.visits.arrived", "Came to the shop")} value={data.visits.arrived} max={data.visits.booked} tone="green" />
                <BarRow label={word(labels, "report.visits.bought", "Bought")} value={data.visits.bought} max={data.visits.booked} tone="green" />
                <BarRow label={word(labels, "report.visits.noshow", "Did not come")} value={data.visits.noShow} max={data.visits.booked} tone="amber" />
                <BarRow label={word(labels, "report.visits.cancelled", "Cancelled")} value={data.visits.cancelled} max={data.visits.booked + data.visits.cancelled} tone="muted" />
              </ul>
              <h3 className="mb-2 mt-6 text-base font-semibold">{word(labels, "report.visits.byday", "Visits by day")}</h3>
              <DayColumns
                days={data.visits.perDay.map((value, i) => ({ label: days[i], value }))}
                aria={word(labels, "report.visits.byday.aria", "Visits booked each day, Monday first: {list}", { list: data.visits.perDay.map((v, i) => `${days[i]} ${v}`).join(", ") })}
              />
              {data.visits.capped ? <p className={mutedText}>{word(labels, "report.visits.capped", "Only the first {n} visits of the week are counted.", { n: 300 })}</p> : null}
            </>
          )}
        </section>

        <div className="flex flex-col gap-4">
          <section aria-labelledby="rp-messages" className={surface}>
            <h2 id="rp-messages" className={h2}>
              {word(labels, "report.messages.title", "WhatsApp messages")}
            </h2>
            {data.messages === "error" ? (
              <Unreadable labels={labels} />
            ) : data.messages.sent + data.messages.waiting + data.messages.blocked === 0 ? (
              <Empty text={word(labels, "report.messages.empty", "No messages this week yet.")} />
            ) : (
              <ul className="mt-4 flex flex-col gap-4">
                {(() => {
                  const max = Math.max(data.messages.sent, data.messages.waiting, data.messages.blocked);
                  return (
                    <>
                      <BarRow label={word(labels, "report.messages.sent", "Sent")} value={data.messages.sent} max={max} tone="green" />
                      <BarRow label={word(labels, "report.messages.waiting", "Waiting for you")} value={data.messages.waiting} max={max} tone="amber" />
                      <BarRow label={word(labels, "report.messages.blocked", "Blocked")} value={data.messages.blocked} max={max} tone="red" />
                    </>
                  );
                })()}
              </ul>
            )}
          </section>

          <section aria-labelledby="rp-response" className={surface}>
            <h2 id="rp-response" className={h2}>
              {word(labels, "report.response.title", "How fast you say OK")}
            </h2>
            {data.approval === "error" ? (
              <Unreadable labels={labels} />
            ) : data.approval === null ? (
              <p className={bodyText}>{word(labels, "report.response.none", "No message you approved was sent this week yet.")}</p>
            ) : (
              <>
                <p className="mt-3 font-display text-4xl font-bold">{minutesText(labels, data.approval.medianMinutes)}</p>
                <p className={mutedText}>
                  {word(labels, "report.response.hint", "Half of the messages you approved went within this time of starting to wait.")}{" "}
                  {data.approval.count === 1 ? word(labels, "report.response.count.one", "Counted from 1 approved message.") : word(labels, "report.response.count.other", "Counted from {count} approved messages.", { count: data.approval.count })}
                </p>
              </>
            )}
            <p className={mutedText}>{word(labels, "report.response.customer", "How fast customers hear back from you is not available yet.")}</p>
          </section>
        </div>

        {catalogue ? (
        <section aria-labelledby="rp-sarees" className={surface}>
          <h2 id="rp-sarees" className={h2}>
            {word(labels, "report.sarees.title", "Sarees sent most")}
          </h2>
          {data.sarees === "error" ? (
            <Unreadable labels={labels} />
          ) : data.sarees.top.length === 0 ? (
            <>
              <Empty text={word(labels, "report.sarees.empty", "No saree photos were sent this week yet.")} />
              {data.sarees.unmatched > 0 ? <p className={mutedText}>{unmatchedText(labels, data.sarees.unmatched)}</p> : null}
            </>
          ) : (
            <>
              <ol className="mt-4 flex flex-col gap-4">
                {data.sarees.top.map((s) => (
                  <BarRow
                    key={s.id}
                    label={s.name}
                    value={s.count}
                    max={data.sarees === "error" ? 0 : data.sarees.top[0].count}
                    text={s.count === 1 ? word(labels, "report.sarees.one", "1 time") : word(labels, "report.sarees.other", "{n} times", { n: s.count })}
                  />
                ))}
              </ol>
              {data.sarees.unmatched > 0 ? <p className={mutedText}>{unmatchedText(labels, data.sarees.unmatched)}</p> : null}
              {data.sarees.capped ? <p className={mutedText}>{word(labels, "report.sarees.capped", "Only the first {n} sent messages are counted.", { n: 300 })}</p> : null}
            </>
          )}
        </section>
        ) : null}

        <section aria-labelledby="rp-usage" className={surface}>
          <h2 id="rp-usage" className={h2}>
            {word(labels, "report.usage.title", "Agent OWL this week")}
          </h2>
          {data.aiPercent === "error" ? (
            <Unreadable labels={labels} />
          ) : (
            <>
              <p className="mt-3 font-display text-4xl font-bold">{word(labels, "report.usage.used", "{percent}% used", { percent: data.aiPercent })}</p>
              <div role="meter" aria-label={word(labels, "report.usage.aria", "Agent OWL usage this week: {percent}% used", { percent: data.aiPercent })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.aiPercent} className="mt-3 h-3 overflow-hidden rounded-full bg-surface-2">
                <div className={`h-full rounded-full ${data.aiPercent >= 90 ? "bg-amber-text" : "bg-brand"} ${fillClass(data.aiPercent)}`} />
              </div>
              <p className={mutedText}>{word(labels, "report.usage.hint", "Of this week's allowance. It starts again on Monday.")}</p>
            </>
          )}
        </section>
      </div>
      {more}
    </div>
  );
}

/** What a person who is not an owner or admin sees at this address. */
export function ReportNoAccess({ labels }: { labels: Labels }) {
  return (
    <div className={`${surface} flex items-center gap-3`}>
      <AgentMark px={56} mood={"resting"} className="size-14 shrink-0" />
      <div>
        <h1 className="font-display text-xl font-bold">{word(labels, "report.noaccess.title", "This page is for the owner and admins")}</h1>
        <p className="mt-1">{word(labels, "report.noaccess.body", "Ask the owner to share the week's numbers with you.")}</p>
      </div>
    </div>
  );
}
