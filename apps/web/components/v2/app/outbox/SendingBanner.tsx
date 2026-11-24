import { say, type TodayWords } from "../today/today-words";

/**
 * "Sending is stopped" (the system-wide kill switch is off, job AT/AX). The platform team owns that switch; the business can only see it. A demo workspace says it is a demo and never calls anything stopped by mistake. One neutral
 * pattern for every notice (owner, 25 Nov 2026: no tinted box): a small amber dot and one grey sentence between hairlines, in words and not in colour alone. Drawn for the people who may read the sending settings (Owner and Admin).
 */
export function SendingBanner({ words, demo = false }: { words: TodayWords; demo?: boolean }) {
  return (
    <p role="status" data-banner="sending-stopped" className="m-0 flex items-start gap-2.5 border-y border-line py-3 text-[15px] leading-snug text-muted">
      <span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full bg-amber-text" />
      <span className="min-w-0">
        {demo ? null : <b className="font-semibold text-ink">{say(words, "outbox.stopped.title")}. </b>}
        {say(words, demo ? "outbox.stopped.demo" : "outbox.stopped.body")}
      </span>
    </p>
  );
}
