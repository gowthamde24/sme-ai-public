import { redirect } from "next/navigation";

import { AiTeamView } from "@/components/v2/app/aiteam/AiTeamView";
import { StandupCard } from "@/components/v2/app/aiteam/StandupCard";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import type { Lang } from "@/i18n/lang";
import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";

import { menuTitle } from "../menu-title";
import { remakeStandupAction, switchHelperAction } from "./actions";
import { dayOrToday, readDay, readStandup, todayIndia, type TeamCtx } from "./ai-team-data";
import { teamWords } from "./team-words";

/** /ai-team when AI_TEAM_SCREENS is on (job ai-team-v2): the stand-up (Owner, Admin), the flow strip, today's shift and the helper panel. The first paint is the server's day; the browser then follows it live. */
export async function AiTeamV2Page({ ctx, lang, wantedDate }: { ctx: TeamCtx; lang: Lang; wantedDate: string | undefined }) {
  const base = `/app/tenants/${ctx.tenantId}`;
  const today = todayIndia();
  const date = dayOrToday(wantedDate);
  const manages = ctx.role === "owner" || ctx.role === "admin";
  const words = teamWords(lang);
  let day;
  let standup = null;
  try {
    [day, standup] = await Promise.all([readDay(ctx, date), manages ? readStandup(ctx, date).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)) : Promise.resolve(null)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const title = await menuTitle("aiteam", lang, ctx.token, ctx.tenantId);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={title} sub={words["aiteam.sub"]} />
      <AiTeamView
        key={date}
        tenantId={ctx.tenantId}
        base={base}
        date={date}
        today={today}
        initialDay={day}
        words={words}
        manages={manages}
        onSwitch={manages ? switchHelperAction.bind(null, ctx.tenantId) : null}
        mfaHref={`${base}/settings?section=security`}
        standup={manages ? <StandupCard key={date} base={base} date={date} isToday={date === today} initial={standup} words={words} remake={remakeStandupAction.bind(null, ctx.tenantId)} /> : undefined}
      />
    </main>
  );
}
