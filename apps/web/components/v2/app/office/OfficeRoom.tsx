"use client";

import { ArrowRight, Armchair, Boxes, Info, List } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { pageH1 } from "../ui";
import { AgentMark } from "../mark/AgentMark";
import { StateDot } from "../mark/StateDot";
import { ALL_AGENT_IDS, type AgentId, type Pose } from "./ids";
import { poseOf } from "./pose";
import { TeamBoard } from "./TeamBoard";
import { readClientEnv, rememberView, type ClientEnv, type View } from "./view";

/** One helper as the room and the list draw it: the API's row (`getAgentsStatus()`), and the "how long ago" worked out on the server so the first paint and the hydrated page agree. */
export type RoomRow = { agent: AgentId; state: "idle" | "working" | "switched_off" | "not_available"; job: string; event: { text: string; ago: string; at: string; /** The page the event is about, inside this workspace; null = it has none (no link). */ href?: string | null } | null };
/** The words of the screen in the person's language, resolved by the server (this file holds no dictionary: i18n/app.ts is server only). */
export type Words = Readonly<Record<string, string>>;

const card = "rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)]";
const pill = "inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-semibold";
const STATE_PILL = { working: "border-brand-edge bg-brand-bg text-brand-text", idle: "border-line bg-surface-2 text-muted", switched_off: "border-line bg-surface-2 text-ink", not_available: "border-line bg-surface-2 text-ink" } as const;
const noSubscribe = () => () => {};

/** The state dot beside a helper's still picture in the List and the panel (the still has one pose). */
const dotOf = (s: RoomRow["state"]) => (s === "working" ? "working" : s === "idle" ? "idle" : "off");

/**
 * The Office: the plush room or the list, the chosen helper's panel and the event feed. Every fact is `getAgentsStatus()`'s: the state on each tag, the job, the latest event; the room
 * has no events of its own. The room is plain DOM and CSS (PlushOffice.tsx), so the server draws it and every device can: the room is the first view, the List is one press away and is remembered
 * if chosen (view.ts). With reduced motion or a data saver the owls are still pictures. Choosing a helper (a tap on the owl or on a tag, or a card of the list) shows their panel and writes
 * `?agent=` into the address, which is also a real link.
 */
export function OfficeRoom({ rows, selected: given, base, words }: { rows: readonly RoomRow[]; selected: AgentId | null; base: string; words: Words }) {
  const w = (key: string) => words[key] ?? key;
  const cache = React.useRef<ClientEnv | null>(null);
  const env = React.useSyncExternalStore(noSubscribe, () => (cache.current ??= readClientEnv()), () => null);
  const [choice, setChoice] = React.useState<View | null>(null);
  const [selected, setSelected] = React.useState<AgentId | null>(given);

  const view: View = choice ?? env?.remembered ?? "room";
  const showRoom = view === "room";

  const chooseView = (v: View) => {
    setChoice(v);
    rememberView(v);
  };

  const select = React.useCallback((id: AgentId | null) => {
    setSelected(id);
    try {
      window.history.replaceState(window.history.state, "", id ? `?agent=${encodeURIComponent(id)}` : window.location.pathname);
    } catch {
      /* the address is only a convenience */
    }
  }, []);

  const stateText = (s: RoomRow["state"]) => (s === "working" ? w("office.working") : s === "idle" ? w("office.idle") : s === "switched_off" ? w("office.switchedoff") : w("frame.notyet"));
  const byId = React.useMemo(() => Object.fromEntries(rows.map((r) => [r.agent, r])) as Record<AgentId, RoomRow>, [rows]);
  const names = Object.fromEntries(ALL_AGENT_IDS.map((id) => [id, w(`agent.${id}`)])) as Record<AgentId, string>;
  const stateOf = (id: AgentId): RoomRow["state"] => byId[id]?.state ?? "not_available"; // the API always sends all seven; a missing one is shown as not there, never made up
  const tagText = Object.fromEntries(ALL_AGENT_IDS.map((id) => [id, stateText(stateOf(id))])) as Record<AgentId, string>;
  const poses = React.useMemo(() => Object.fromEntries(ALL_AGENT_IDS.map((id) => [id, poseOf(byId[id]?.state ?? "not_available")])) as Record<AgentId, Pose>, [byId]);
  const chosen = selected ? (byId[selected] ?? null) : null;
  const feed = rows.filter((r) => r.event).sort((a, b) => Date.parse(b.event!.at) - Date.parse(a.event!.at)).slice(0, 6);

  return (
    <div data-screen="office" data-view={showRoom ? "room" : "list"}>
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className={pageH1}>{w("office.title")}</h1>
          <p className="text-base text-muted">{w("office.sub")}</p>
        </div>
        <div role="group" aria-label={w("office.viewswitch")} className="inline-flex shrink-0 self-start rounded-xl border border-edge bg-surface p-1">
          {(["room", "list"] as const).map((v) => {
            const on = (v === "room") === showRoom;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => chooseView(v)}
                className={`inline-flex min-h-11 items-center rounded-lg px-4 text-base font-semibold ${on ? "bg-charcoal text-on-charcoal" : "text-ink hover:bg-surface-2"}`}
              >
                {v === "room" ? w("office.viewroom") : w("office.viewlist")}
              </button>
            );
          })}
        </div>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {showRoom ? (
            <TeamBoard poses={poses} names={names} stateText={tagText} selected={selected} onSelect={select} label={w("office.title")} hint={w("office.hint")} />
          ) : (
            <section aria-label={w("office.title")}>
              <p className="mb-3 flex items-center gap-2 text-base text-muted">
                <List className="size-4 shrink-0" aria-hidden="true" />
                {w("office.listintro")}
              </p>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {rows.map((a) => (
                  <li key={a.agent}>
                    <Link
                      href={`${base}/office?agent=${encodeURIComponent(a.agent)}`}
                      prefetch={false}
                      scroll={false}
                      aria-current={a.agent === selected ? "true" : undefined}
                      onClick={(e) => {
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        select(a.agent);
                      }}
                      className={`${card} flex min-h-24 flex-col gap-1 hover:border-edge ${a.agent === selected ? "border-brand-edge ring-2 ring-brand-edge" : ""}`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <AgentMark agent={a.agent} px={44} mood={a.state === "working" ? "thinking" : "idle"} off={dotOf(a.state) === "off"} className="size-11" />
                          <StateDot state={dotOf(a.state)} />
                          <span className="font-display text-lg font-semibold">{w(`agent.${a.agent}`)}</span>
                        </span>
                        <span className={`${pill} ${STATE_PILL[a.state]}`}>{stateText(a.state)}</span>
                      </span>
                      <span className="text-base">{a.job}</span>
                      {a.event ? <span className="line-clamp-2 text-sm text-muted">{`${a.event.text} · ${a.event.ago}`}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="feed-heading" className={card}>
            <h2 id="feed-heading" className="mb-2 flex items-center gap-2 font-display text-xl font-semibold">
              <Boxes className="size-5 text-brand-text" aria-hidden="true" />
              {w("office.feed")}
            </h2>
            {feed.length === 0 ? (
              <p className="text-base text-muted">{w("office.noevents")}</p>
            ) : (
              <ol className="divide-y divide-line">
                {feed.map((r) => (
                  <li key={r.agent} className="flex min-h-14 flex-col justify-center py-2">
                    <p className="text-sm text-muted">{`${r.event!.ago} · ${w(`agent.${r.agent}`)}`}</p>
                    {r.event!.href ? <Link href={r.event!.href} prefetch={false} className="inline-flex min-h-11 items-center text-base font-medium text-brand-text underline-offset-2 hover:underline">{r.event!.text}</Link> : <p className="text-base">{r.event!.text}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:col-span-4">
          <section aria-labelledby="latest-heading" aria-live="polite" className={card}>
            {chosen ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
                    <AgentMark agent={chosen.agent} px={44} mood={chosen.state === "working" ? "thinking" : "idle"} off={dotOf(chosen.state) === "off"} className="size-11" />
                    <StateDot state={dotOf(chosen.state)} />
                    {w(`agent.${chosen.agent}`)}
                  </h2>
                  <span className={`${pill} ${STATE_PILL[chosen.state]}`}>{stateText(chosen.state)}</span>
                </div>
                <p className="mt-1 text-base">{chosen.job}</p>
                <h3 id="latest-heading" className="mt-3 text-sm font-semibold">
                  {w("office.latest")}
                </h3>
                {chosen.event?.href ? (
                  <p className="mt-1 text-base">
                    <Link href={chosen.event.href} prefetch={false} className="inline-flex min-h-11 items-center font-medium text-brand-text underline-offset-2 hover:underline">{chosen.event.text}</Link>
                    {` · ${chosen.event.ago}`}
                  </p>
                ) : (
                  <p className="mt-1 text-base">{chosen.event ? `${chosen.event.text} · ${chosen.event.ago}` : w("office.noevents")}</p>
                )}
              </>
            ) : (
              <p id="latest-heading" className="flex items-start gap-3 text-base text-muted">
                <Armchair className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                {w("office.pick")}
              </p>
            )}
          </section>
          <Link href={`${base}/agents`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-base font-semibold text-brand-text hover:underline">
            {w("office.runs")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </div>
  );
}
