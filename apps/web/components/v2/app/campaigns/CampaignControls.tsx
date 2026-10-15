"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, primary, quiet, secondary } from "../visits/styles";

type Result = { ok: true } | { ok: false; error: string; mfa?: boolean };
export type StateAction = (action: "pause" | "resume" | "cancel") => Promise<Result>;

/** Pause, resume or cancel a campaign (job CQ; Owner and Admin). Pausing stops the steps that have not gone yet and can be undone; cancelling cannot. Messages already sent stay sent. Each asks first. */
export function CampaignControls({ status, words, act }: { status: string; words: TodayWords; act: StateAction }) {
  const router = useRouter();
  const [ask, setAsk] = React.useState<null | "pause" | "resume" | "cancel">(null);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const live = status === "approved" || status === "running";
  if (!live && status !== "paused") return null;
  async function go() {
    if (!ask) return;
    setBusy(true);
    setProblem(null);
    const out = await act(ask);
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setAsk(null);
    router.refresh();
  }
  return (
    <div data-part="controls" className="flex flex-wrap items-center gap-3">
      {live ? <button type="button" className={secondary} onClick={() => setAsk("pause")}>{say(words, "camp.ctl.pause")}</button> : null}
      {status === "paused" ? <button type="button" className={primary} onClick={() => setAsk("resume")}>{say(words, "camp.ctl.resume")}</button> : null}
      <button type="button" className={secondary} onClick={() => setAsk("cancel")}>{say(words, "camp.ctl.cancel")}</button>
      <Sheet open={ask !== null} onClose={() => !busy && setAsk(null)} busy={busy} id="campaign-state" title={ask ? say(words, `camp.ctl.${ask}.title`) : ""} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{ask ? say(words, `camp.ctl.${ask}.body`) : ""}</p>
        {problem ? (
          <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
            <p>{problem.text}</p>
            {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" data-autofocus className={primary} disabled={busy} onClick={() => void go()}>{busy ? say(words, "today.act.working") : ask ? say(words, `camp.ctl.${ask}.go`) : ""}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setAsk(null)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </div>
  );
}
