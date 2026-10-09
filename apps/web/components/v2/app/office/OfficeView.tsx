import { ArrowRight, Armchair } from "lucide-react";
import Link from "next/link";

import { pageH1 } from "../ui";
import { ago } from "../today/TodayView";
import type { AgentRow, T } from "../today/types";
import { OfficeRoom, type RoomRow, type Words } from "./OfficeRoom";
import { ALL_AGENT_IDS, type AgentId } from "./scene/ids";

const card = "rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)]";
/** Every word the room needs, resolved here in the person's language (the client file holds no dictionary). */
const WORD_KEYS = [
  "office.title", "office.sub", "office.idle", "office.working", "office.switchedoff", "frame.notyet", "office.latest", "office.noevents", "office.pick", "office.runs",
  "office.view3d", "office.viewlist", "office.viewswitch", "office.hint", "office.loading", "office.nowebgl", "office.loaderror", "office.still", "office.feed",
  ...ALL_AGENT_IDS.map((id) => `agent.${id}`),
];

/**
 * The Office (docs/plans/office-3d-proposal.md): the helpers as a 3D room around one table, or as a list, and the event feed. `agents` are the rows of `getAgentsStatus()` (always all seven);
 * null = they cannot be read and the screen says "Not available yet" (it names no agent it cannot verify). A helper that is `not_available` is not built; `switched_off` has its switch off:
 * each says so, on its tag and its card. The chosen helper is `?agent=` (a real link). "Runs and cost" is the existing page of agent runs. The server draws the List; OfficeRoom (client)
 * decides, on the device, whether the 3D view is the first view and loads three.js only then.
 */
export function OfficeView({ agents, selected, base, t }: { agents: AgentRow[] | null; selected: string | null; base: string; t: T }) {
  if (agents === null) {
    return (
      <div data-screen="office">
        <header>
          <h1 className={pageH1}>{t("office.title")}</h1>
          <p className="text-base text-muted">{t("office.sub")}</p>
        </header>
        <div className="mt-6 space-y-4 lg:max-w-2xl">
          <div className={`${card} flex items-center gap-3`}>
            <Armchair className="size-6 shrink-0 text-muted" aria-hidden="true" />
            <p className="text-base text-muted">{t("frame.notyet")}</p>
          </div>
          <Link href={`${base}/agents`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-base font-semibold text-brand-text hover:underline">
            {t("office.runs")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }
  const words: Words = Object.fromEntries(WORD_KEYS.map((k) => [k, t(k)]));
  const rows: RoomRow[] = agents.map((a) => ({ agent: a.agent, state: a.state, job: a.job, event: a.last_event ? { text: a.last_event.text, ago: ago(a.last_event.at), at: a.last_event.at } : null }));
  const chosen = selected !== null && (ALL_AGENT_IDS as readonly string[]).includes(selected) ? (selected as AgentId) : null;
  return <OfficeRoom rows={rows} selected={chosen} base={base} words={words} />;
}
