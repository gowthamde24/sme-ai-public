"use client";

import * as React from "react";

import { BRAND_NAME } from "@/design/brand";

import { Choose } from "../../jobs/rules/parts";
import { canFeel, feel, feelOn, setFeel, subscribeFeel } from "../../feel/feel";
import { askPing, pingPermission, pingSetting, setPing, subscribePing } from "../../live/call-ping";
import { makeT } from "../../words";
import { SelectField } from "./fields";
import { EffectBox, Sentence } from "./parts";

/**
 * Settings > Notifications under JOBS (the simplicity pass): the same two switches of the old card as two sentences with a yes/no inside ("Tell me on this device when a call starts: [yes]"), the same permission sentence, and a live "What it will do:" line.
 * Both are for THIS device (the browser's own storage) and answer at once, like the old switches: turning calls on asks the browser for permission from that tap; a browser that cannot, or one that blocked it, says so in words and the choice stays "no".
 */
export function NotificationsSimple({ words, bare = false, plain = false }: { /** SETTINGS_OPEN: plain labelled fields. */ plain?: boolean; words: Readonly<Record<string, string>>; /** drawn inside a card of the Settings page that has its own title (no title, no frame of its own) */ bare?: boolean }) {
  const t = makeT(words);
  const setting = React.useSyncExternalStore(subscribePing, () => pingSetting() ?? "none", () => "none");
  const permission = React.useSyncExternalStore(subscribePing, pingPermission, () => "default" as const);
  const feelState = React.useSyncExternalStore(subscribeFeel, () => (feelOn() ? "on" : "off"), () => "off");
  const feelHere = React.useSyncExternalStore(subscribeFeel, canFeel, () => false);
  const on = setting === "on" && permission === "granted";
  const state = permission === "unsupported" ? "unsupported" : permission === "denied" ? "denied" : permission === "granted" ? "granted" : "default";
  const yesNo = (o: string) => t(`jobs.set.not.opt.${o}`);
  const fx = [t(on ? "jobs.set.not.fx.calls.on" : "jobs.set.not.fx.calls.off"), feelHere && feelState === "on" ? t("jobs.set.not.fx.feel") : ""].filter(Boolean).join(" ");
  const lead = (key: string) => t(key).replace(/\s*[:：]\s*\{[a-z]+\}[.।]?$/, "");
  const plainBody = (
    <>
      <SelectField
        label={lead("jobs.set.not.line.calls")}
        hint={t("jobs.set.not.help")}
        value={on ? "on" : "off"}
        options={["on", "off"].map((o) => ({ value: o, label: yesNo(o) }))}
        disabled={state === "unsupported" || (state === "denied" && !on)}
        onChange={(v) => {
          if (v === "off") setPing(false);
          else void askPing();
        }}
      />
      {feelHere ? (
        <SelectField
          label={lead("jobs.set.not.line.feel")}
          value={feelState}
          options={["on", "off"].map((o) => ({ value: o, label: yesNo(o) }))}
          onChange={(v) => {
            setFeel(v === "on");
            if (v === "on") setTimeout(() => feel("done"), 50);
          }}
        />
      ) : null}
      <p className="m-0 text-sm font-semibold text-ink" role="status" data-part="permission" data-state={state}>
        {t(`nset.state.${state}`)}
      </p>
      <p className="m-0 text-sm text-muted">{t("nset.note").replaceAll("{brand}", BRAND_NAME)}</p>
    </>
  );
  const body = plain ? plainBody : (
    <>
      <p className="m-0 text-[14px] text-muted">{t("jobs.set.not.help")}</p>
      <Sentence
        line="calls"
        template={t("jobs.set.not.line.calls")}
        parts={{
          calls: (aria) => (
            <Choose
              aria={aria}
              value={on ? "on" : "off"}
              options={["on", "off"]}
              text={yesNo}
              disabled={state === "unsupported" || (state === "denied" && !on)}
              onChange={(v) => {
                if (v === "off") setPing(false);
                else void askPing();
              }}
            />
          ),
        }}
      />
      {feelHere ? (
        <Sentence
          line="feel"
          template={t("jobs.set.not.line.feel")}
          parts={{
            feel: (aria) => (
              <Choose
                aria={aria}
                value={feelState}
                options={["on", "off"]}
                text={yesNo}
                onChange={(v) => {
                  setFeel(v === "on");
                  if (v === "on") setTimeout(() => feel("done"), 50); // (the first buzz, so the person feels what it is)
                }}
              />
            ),
          }}
        />
      ) : null}
      <EffectBox label={t("jobs.set.effect")} text={fx} />
      <p className="m-0 text-sm font-semibold text-ink" role="status" data-part="permission" data-state={state}>
        {t(`nset.state.${state}`)}
      </p>
      <p className="m-0 text-sm text-muted">{t("nset.note").replaceAll("{brand}", BRAND_NAME)}</p>
    </>
  );
  if (bare) return <div className="flex flex-col gap-3" data-part="notifications-simple">{body}</div>;
  return (
    <section aria-labelledby="nset-title" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5" data-part="notifications">
      <h2 id="nset-title" className="m-0 font-display text-[17px] font-bold leading-tight text-ink">
        {t("nset.title")}
      </h2>
      {body}
    </section>
  );
}
