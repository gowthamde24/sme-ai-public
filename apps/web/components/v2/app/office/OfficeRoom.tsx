"use client";

import { ArrowRight, Armchair, Boxes, Info, List, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { pageH1 } from "../ui";
import { readClientEnv, rememberView, type ClientEnv, type View } from "./scene/capability";
import { ALL_AGENT_IDS, type AgentId, type Pose } from "./scene/ids";
import { webglAvailable } from "./scene/webgl";
import { OfficeStage } from "./OfficeStage";

/** One helper as the room and the list draw it: the API's row (`getAgentsStatus()`), and the "how long ago" worked out on the server so the first paint and the hydrated page agree. */
export type RoomRow = { agent: AgentId; state: "idle" | "working" | "switched_off" | "not_available"; job: string; event: { text: string; ago: string; at: string } | null };
/** The words of the screen in the person's language, resolved by the server (this file holds no dictionary: i18n/app.ts is server only). */
export type Words = Readonly<Record<string, string>>;

const card = "rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)]";
const pill = "inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-semibold";
const STATE_PILL = { working: "border-brand-edge bg-brand-bg text-brand-text", idle: "border-line bg-surface-2 text-muted", switched_off: "border-line bg-surface-2 text-ink", not_available: "border-line bg-surface-2 text-ink" } as const;
const noSubscribe = () => () => {};

const poseOf = (s: RoomRow["state"]): Pose => (s === "working" ? "working" : s === "idle" ? "idle" : "off");

/**
 * The Office: the room (3D) or the list, the chosen helper's panel and the event feed. Every fact is `getAgentsStatus()`'s: the state on each tag, the job, the latest event; the room
 * has no events of its own. The server draws the List (every device can show it, and it works without script); on the client the 3D view is the first view on a device that can clearly
 * run it, and the List on a weak one, with reduced motion, or when WebGL is missing (scene/capability.ts). Three.js is a separate chunk, requested only when the 3D view is shown.
 * Choosing a helper (a tap on the person or on a tag, or a card of the list) shows their panel and writes `?agent=` into the address, which is also a real link.
 */
export function OfficeRoom({ rows, selected: given, base, words }: { rows: readonly RoomRow[]; selected: AgentId | null; base: string; words: Words }) {
  const w = (key: string) => words[key] ?? key;
  const cache = React.useRef<ClientEnv | null>(null);
  const env = React.useSyncExternalStore(noSubscribe, () => (cache.current ??= readClientEnv()), () => null);
  const [choice, setChoice] = React.useState<View | null>(null);
  const [selected, setSelected] = React.useState<AgentId | null>(given);
  const [fallback, setFallback] = React.useState<"webgl" | "error" | null>(null);
  const [probe, setProbe] = React.useState<boolean | null>(null);

  const view: View = choice ?? env?.remembered ?? env?.defaultView ?? "list";
  const webglOk = env !== null && (probe ?? env.webgl);
  const show3d = view === "3d" && env !== null && webglOk && fallback === null;
  const noticeWebgl = view === "3d" && env !== null && (!webglOk || fallback === "webgl");
  const noticeError = view === "3d" && fallback === "error";

  const chooseView = (v: View) => {
    if (v === "3d") {
      setFallback(null); // look again, do not trust an old answer
      setProbe(webglAvailable());
    }
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
    <div data-screen="office" data-view={show3d ? "3d" : "list"}>
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className={pageH1}>{w("office.title")}</h1>
          <p className="text-base text-muted">{w("office.sub")}</p>
        </div>
        <div role="group" aria-label={w("office.viewswitch")} className="inline-flex shrink-0 self-start rounded-xl border border-edge bg-surface p-1">
          {(["3d", "list"] as const).map((v) => {
            const on = (v === "3d") === show3d;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => chooseView(v)}
                onPointerEnter={v === "3d" ? () => void import("./scene/Office3D") : undefined}
                onFocus={v === "3d" ? () => void import("./scene/Office3D") : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg px-4 text-base font-semibold ${on ? "bg-charcoal text-on-charcoal" : "text-ink hover:bg-surface-2"}`}
              >
                {v === "3d" ? w("office.view3d") : w("office.viewlist")}
              </button>
            );
          })}
        </div>
      </header>

      {noticeWebgl || noticeError ? (
        <p role="status" data-fallback={noticeError ? "error" : "webgl"} className="mt-4 flex items-start gap-2 rounded-lg border border-amber-text bg-amber-bg p-3 text-amber-text">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span className="font-medium">{noticeError ? w("office.loaderror") : w("office.nowebgl")}</span>
        </p>
      ) : null}
      {show3d && env?.reducedMotion ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          {w("office.still")}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {show3d && env ? (
            <OfficeStage poses={poses} names={names} stateText={tagText} selected={selected} onSelect={select} reduced={env.reducedMotion} coarse={env.coarse} phone={env.phone} hint={w("office.hint")} loadingText={w("office.loading")} onFail={setFallback} />
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
                        <span className="font-display text-lg font-semibold">{w(`agent.${a.agent}`)}</span>
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
                    <p className="text-base">{r.event!.text}</p>
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
                  <h2 className="font-display text-xl font-semibold">{w(`agent.${chosen.agent}`)}</h2>
                  <span className={`${pill} ${STATE_PILL[chosen.state]}`}>{stateText(chosen.state)}</span>
                </div>
                <p className="mt-1 text-base">{chosen.job}</p>
                <h3 id="latest-heading" className="mt-3 text-sm font-semibold">
                  {w("office.latest")}
                </h3>
                <p className="mt-1 text-base">{chosen.event ? `${chosen.event.text} · ${chosen.event.ago}` : w("office.noevents")}</p>
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
