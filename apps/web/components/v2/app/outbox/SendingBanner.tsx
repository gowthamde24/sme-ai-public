import { ShieldAlert } from "lucide-react";

import { say, type TodayWords } from "../today/today-words";

/**
 * "Sending is stopped" (the system-wide kill switch is off, job AT/AX). The Stack19 team owns that switch; the business can only see it. A demo workspace says it is a demo ("Demo workspace: sending is switched off ...") and never calls anyone an operator. While it is off nothing goes out and everything waits, so Today and the Outbox say it
 * clearly, in words and not in colour alone. Drawn for the people who may read the sending settings (Owner and Admin); `settingsHref` is only passed to the Owner, who can see the rest in Settings.
 */
export function SendingBanner({ words, demo = false }: { words: TodayWords; demo?: boolean }) {
  return (
    <div role="status" data-banner="sending-stopped" className="flex gap-3 rounded-2xl border border-amber-text bg-amber-bg px-4 py-3 text-amber-text">
      <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">{say(words, "outbox.stopped.title")}</p>
        <p className="text-sm">{say(words, demo ? "outbox.stopped.demo" : "outbox.stopped.body")}</p>
      </div>
    </div>
  );
}
