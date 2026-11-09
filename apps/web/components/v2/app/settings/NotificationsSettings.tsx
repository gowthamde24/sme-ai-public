"use client";

import * as React from "react";

import { askPing, pingPermission, pingSetting, setPing, subscribePing } from "../live/call-ping";

type W = Readonly<Record<string, string>>;

/**
 * Settings > Notifications (app v4): the switch for "tell me when a call starts". It is for THIS device (the browser's own storage; the page says so) and asks the browser for permission only when it is turned on, from that tap. The state of
 * the permission is said in words (not asked yet, allowed, blocked, not possible here), never a bare toggle that does nothing.
 */
export function NotificationsSettings({ words }: { words: W }) {
  const setting = React.useSyncExternalStore(subscribePing, () => pingSetting() ?? "none", () => "none");
  const permission = React.useSyncExternalStore(subscribePing, pingPermission, () => "default" as const);
  const on = setting === "on" && permission === "granted";
  const toggle = async () => {
    if (on) {
      setPing(false);
      return;
    }
    await askPing();
  };
  const state = permission === "unsupported" ? "unsupported" : permission === "denied" ? "denied" : permission === "granted" ? "granted" : "default";
  return (
    <section aria-labelledby="nset-title" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5" data-part="notifications">
      <h2 id="nset-title" className="m-0 font-display text-xl font-bold">
        {words["nset.title"]}
      </h2>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-base font-semibold" id="nset-calls">
            {words["nset.calls"]}
          </p>
          <p className="m-0 mt-1 text-sm text-muted">{words["nset.calls.help"]}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="nset-calls"
          disabled={state === "unsupported" || (state === "denied" && !on)}
          onClick={() => void toggle()}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold disabled:opacity-50 ${on ? "border-brand-edge bg-brand-bg text-brand-text" : "border-edge bg-surface text-ink"}`}
          data-part="calls-switch"
        >
          <span aria-hidden="true" className={`size-2.5 rounded-full ${on ? "bg-[#ff773c]" : "bg-muted/60"}`} />
          {on ? words["nset.on"] : words["nset.off"]}
        </button>
      </div>
      <p className="m-0 text-sm font-semibold text-ink" role="status" data-part="permission" data-state={state}>
        {words[`nset.state.${state}`]}
      </p>
      <p className="m-0 text-sm text-muted">{words["nset.note"]}</p>
    </section>
  );
}
