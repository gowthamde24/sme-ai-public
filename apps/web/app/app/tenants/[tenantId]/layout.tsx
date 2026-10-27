import { NO_FRAME_DATA } from "@/components/v2/app/contract";
import Link from "next/link";

import { btnMain } from "@/components/v2/app/ui";
import { ReadOnlyBanner } from "@/components/v2/app/readonly/ReadOnlyBanner";
import { ReadOnlyScope } from "@/components/v2/app/readonly/ReadOnlyScope";
import { ModuleGate } from "@/components/v2/app/frame-store";
import { ProblemView } from "@/components/v2/app/robust/ProblemView";
import type { Availability } from "@/components/v2/app/today/ask/ask-types";
import { AskProvider } from "@/components/v2/app/today/ask/AskProvider";
import { ASK_WORD_KEYS } from "@/components/v2/app/today/ask/ask-words";
import type { DoItOptions } from "@/components/v2/app/today/ask/use-do-it";
import { powersOf } from "@/components/v2/app/tasks/task-actions";
import { appDict, appT } from "@/i18n/app";
import { withModuleWords } from "@/lib/packs/module-words";
import { FrameDataSlot } from "@/components/v2/app/frame-store";
import { type Access } from "@/lib/api/billing-access";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getLang } from "@/i18n/get-lang";
import { fetchTenant } from "@/lib/api/client";
import { requireUser } from "@/lib/auth/session";
import { taskScreens } from "@/lib/screens/flag";
import { ADDRESSES } from "@/lib/site/business";

import { readFrameData } from "../../frame-data";
import { boundTaskActions } from "./tasks-bound";
import { topupLayoutBanner } from "./topup-banner";
import { readAccessCached, readAgentsCached } from "./today-read";

/**
 * The layout of one workspace. It draws nothing of its own: the frame is drawn by the layout of /app, which cannot know which workspace the address is in, so this one reads
 * what the frame shows for THIS workspace (the plan, the AI usage, the count on Today) and hands it to the frame. A page decides access as before; if a read fails the
 * frame says "Not available yet" in that one place and the page shows its own error.
 * It also holds the ONE conversation with the assistant (job DQ part 0, AskProvider): Today draws it in the assistant's card and every other screen as the floating orb and its panel; there is no bar at the bottom any more (the Ask dock of job DN is gone).
 * And when the workspace is READ-ONLY (its trial ended without a payment: job DP) it draws the one explanation at the top and switches off every edit, send, AI and call control (components/v2/app/readonly); the orb is left out.
 */
export default async function TenantLayout({ children, params }: LayoutProps<"/app/tenants/[tenantId]">) {
  const { tenantId } = await params;
  const user = await requireUser();
  const lang = await getLang();
  const data = isCanonicalUuid(tenantId) ? await readFrameData(user.accessToken, tenantId, lang) : NO_FRAME_DATA;
  // the 403 page for a MOVE inside the app to a part the business type does not have (job CL; a typed address is judged by template.tsx): made here, in the person's language, and drawn by the gate only when needed
  const dict = appDict(lang) as Record<string, string>;
  const labels = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("problem.")));
  const access = isCanonicalUuid(tenantId) ? await workspaceAccess(user.accessToken, tenantId) : { readOnly: false as const };
  const availability: Availability = isCanonicalUuid(tenantId) ? await assistantAvailability(user.accessToken, tenantId) : "not_available";
  const t = appT(lang);
  const doIt = isCanonicalUuid(tenantId) && !access.readOnly ? await doItFor(user.accessToken, tenantId, dict) : null;
  const askWords = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, t(k)]));
  // the suggestion chips of the screens, in the person's language and for the business type (`ask.chip.quotes@programmes`)
  const chipWords = withModuleWords(Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("ask.chip."))), data.pack);
  const topupBanner = isCanonicalUuid(tenantId) ? await topupLayoutBanner({ token: user.accessToken, tenantId, lang }) : null;
  return (
    <>
      <FrameDataSlot data={data} />
      {access.readOnly ? (
        <>
          <ReadOnlyBanner
            words={Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("ro.") || k.startsWith("plan.readonly.")))}
            lang={lang}
            access={access}
            resume={access.canResume ? <Link href={`/app/tenants/${tenantId}/plans`} className={`${btnMain} mt-3`}>{t("ro.resume")}</Link> : null}
          />
          <ReadOnlyScope why={t("ro.off", { email: ADDRESSES.billing })} />
        </>
      ) : null}
      {/* the notice at 80 and 100 percent of the minutes or messages (night 4, TOPUP_SCREENS): markup only, nothing when the flag is off */}
      {topupBanner}
      {/* ONE conversation for the workspace (job DQ part 0): Today's card and the floating panel of the other screens read the same thread */}
      <AskProvider lang={lang} base={`/app/tenants/${tenantId}`} words={askWords} chipWords={chipWords} availability={availability} readOnly={access.readOnly} doIt={doIt}>
        {/* a server with no pack routes gives no pack: the product as it always was, every page on */}
        {data.pack ? (
          <ModuleGate modules={data.pack.modules} fallback={<ProblemView kind={403} variant="module" labels={labels} homeHref={`/app/tenants/${tenantId}`} />}>
            {children}
          </ModuleGate>
        ) : (
          children
        )}
      </AskProvider>
    </>
  );
}

/** Whether the workspace is read-only. A read that fails says "not": the API refuses every change in that state all the same, so the worst case is a button that says so when pressed. */
async function workspaceAccess(accessToken: string, tenantId: string): Promise<Access> {
  try {
    return await readAccessCached(accessToken, tenantId);
  } catch {
    return { readOnly: false };
  }
}

/** Whether the assistant can be asked right now, and if not why. A read that fails says "not available": the orb is left out rather than shown with nothing behind it. */
async function assistantAvailability(accessToken: string, tenantId: string): Promise<Availability> {
  try {
    const state = (await readAgentsCached(accessToken, tenantId)).find((a) => a.agent === "main")?.state;
    return state === "idle" || state === "working" ? "live" : state === "switched_off" ? "switched_off" : "not_available";
  } catch {
    return "not_available";
  }
}

/**
 * "Ask Vijaya to do it" inside the one conversation (night 4, tasks): the "Ask | Do it" switch exists only while TASK_SCREENS is on, the workspace is not read-only and the person may make a plan (Owner, Admin, Sales). The server reads the
 * flag and the role; the browser only receives the actions (with the workspace bound) and the words, never the environment.
 */
async function doItFor(accessToken: string, tenantId: string, dict: Record<string, string>): Promise<DoItOptions | null> {
  if (taskScreens() === "off") return null;
  try {
    const powers = powersOf((await fetchTenant(accessToken, tenantId)).role);
    if (!powers.plan) return null;
    return { actions: boundTaskActions(tenantId), powers, words: Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tk.") || k.startsWith("pc."))) };
  } catch {
    return null; // a failed role read: the switch is left out, never guessed
  }
}
