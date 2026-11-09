import { StandupCard } from "@/components/v2/app/aiteam/LazyStandupCard";
import type { Lang } from "@/i18n/lang";

import { remakeStandupAction } from "./actions";
import { readStandup, teamContext, todayIndia } from "./ai-team-data";
import { teamWords } from "./team-words";

/** Today's stand-up card (Owner and Admin, My AI team v2 on): the first two lines, ▶ Play and a link to My AI team. Nothing is drawn when it cannot be read; before opening time it says when it comes. */
export async function standupToday(tenantId: string, lang: Lang) {
  try {
    const ctx = await teamContext(tenantId);
    if (!ctx || (ctx.role !== "owner" && ctx.role !== "admin")) return null;
    const date = todayIndia();
    const standup = await readStandup(ctx, date);
    return (
      <div className="mt-4" data-part="standup-today">
        <StandupCard compact base={`/app/tenants/${tenantId}`} date={date} isToday initial={standup} words={teamWords(lang)} remake={remakeStandupAction.bind(null, tenantId)} />
      </div>
    );
  } catch {
    return null;
  }
}
