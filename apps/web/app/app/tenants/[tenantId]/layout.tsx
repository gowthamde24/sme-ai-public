import { NO_FRAME_DATA } from "@/components/v2/app/contract";
import Link from "next/link";
import { cache } from "react";
import { redirect } from "next/navigation";

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
import { readMyProfileCached } from "../../me-read";
import { getLang } from "@/i18n/get-lang";
import { primeBootstrap } from "@/lib/api/bootstrap";
import { activateRequestMemo } from "@/lib/api/request-memo";
import { fetchTenant, publicApiBase } from "@/lib/api/client";
import { isVoiceLang, voiceSocketUrl, VOICE_LANGS } from "@/lib/browser-voice/protocol";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { audienceModules, isChatCardWord, type Audience } from "@/lib/lead-finder/types";
import { requireUser } from "@/lib/auth/session";
import { assistantWorkScreens, browserVoice, guidedDemo, pronunciationScreens, taskScreens } from "@/lib/screens/flag";
import { readIsDemo } from "./today-read";
import { routesFor } from "@/lib/guided-demo/script";
import { GuidedDemo } from "@/components/v2/app/guided-demo/LazyGuidedDemo";
import { runDemoStepAction } from "./guided-demo-actions";
import { ADDRESSES } from "@/lib/site/business";
import { demoVideoAllowed, requestVideoAddress, videoHref } from "@/lib/demo-video/guard";

import { readFinderAccessCached, readFrameData } from "../../frame-data";
import { upgradeHref } from "@/lib/plan/tier-source";
import { turnOnAssistantAction } from "./ask-switch-actions";
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
  activateRequestMemo(); // (REQUEST_MEMO=1 only: from here on an identical read of this render is asked once; lib/api/request-memo.ts)
  const { tenantId } = await params;
  const user = await requireUser();
  const lang = await getLang();
  const token = user.accessToken;
  const valid = isCanonicalUuid(tenantId);
  if (valid) primeBootstrap(token, tenantId); // (BOOTSTRAP=1 only: the one request for what the reads below ask; lib/api/bootstrap.ts)
  // the demo-video mode (job demo-video, lib/demo-video/guard.ts): its story has its own page (/demo-video), so any other screen asked with ?demo=video starts it at step 1; while it plays, nothing of the workspace's own moves on screen (no "Live now", no notices, no guided demo)
  const asked = await requestVideoAddress();
  // EVERY read of the API below starts now, at once, and the page waits for them together (staging, 12 Nov 2026: nine reads one after another made 2-3 s before any screen could start). A read that decides whether another is used
  // (the video check, the access, the availability) is chained, not awaited, so nothing waits for a read it does not need. The person's role is read ONCE for the whole request (`tenantOf`), not once per question.
  const videoP = asked !== null && asked.tenantId.toLowerCase() === tenantId.toLowerCase() ? demoVideoAllowed(token, tenantId) : Promise.resolve(false);
  const readP = valid ? readFrameData(token, tenantId, lang) : Promise.resolve(NO_FRAME_DATA);
  const accessP: Promise<Access> = valid ? workspaceAccess(token, tenantId) : Promise.resolve({ readOnly: false as const });
  const availabilityP: Promise<Availability> = valid ? assistantAvailability(token, tenantId) : Promise.resolve("not_available" as const);
  // the 403 page for a MOVE inside the app to a part the business type does not have (job CL; a typed address is judged by template.tsx): made here, in the person's language, and drawn by the gate only when needed
  const dict = appDict(lang) as Record<string, string>;
  const labels = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("problem.")));
  const t = appT(lang);
  // a switched-off assistant (first run: the workspace's own switch starts off): the Owner and Admin get the button that turns it on, everyone else is told whom to ask
  const mayTurnOnP = availabilityP.then((a) => a === "switched_off" && mayTurnOn(token, tenantId));
  const doItP = accessP.then((a) => (valid && !a.readOnly ? doItFor(token, tenantId, dict) : null));
  // the guided demo (GUIDED_DEMO): only in a workspace that says it is a DEMO one, for its Owner and Admins
  const demoRoutesP = Promise.all([videoP, readP]).then(([v, r]) => (guidedDemo() && !v && valid ? demoRoutesFor(token, tenantId, r.pack?.modules ?? null) : null));
  // "Talk to your assistant" (BROWSER_VOICE): the orb opens the voice chat for the people who may use it (Owner, Admin, Sales); its words, and those of the Lead Finder's card in the chat
  const url = browserVoice() && valid ? voiceSocketUrl(publicApiBase(), tenantId) : null;
  const voiceP = url ? voiceFor(token, tenantId, lang, dict, url) : Promise.resolve(null);
  const topupP = videoP.then((v) => (valid && !v ? topupLayoutBanner({ token, tenantId, lang }) : null));
  const [video, read, access, availability, canTurnOn, doIt, demoRoutes, voice, topupBanner] = await Promise.all([videoP, readP, accessP, availabilityP, mayTurnOnP, doItP, demoRoutesP, voiceP, topupP]);
  if (asked !== null && video && !asked.stage) redirect(videoHref(tenantId));
  const data = video ? { ...read, live: false } : read;
  const turnOn = canTurnOn ? turnOnAssistantAction.bind(null, tenantId) : null;
  const askWords = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, t(k)]));
  // the suggestion chips of the screens, in the person's language and for the business type (`ask.chip.quotes@programmes`)
  const chipWords = withModuleWords(Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("ask.chip."))), data.pack);
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
      <AskProvider lang={lang} base={`/app/tenants/${tenantId}`} words={askWords} chipWords={chipWords} availability={availability} voice={voice} readOnly={access.readOnly} doIt={voice ? null : doIt} turnOn={turnOn}>
        {/* a server with no pack routes gives no pack: the product as it always was, every page on */}
        {data.pack ? (
          <ModuleGate modules={data.pack.modules} fallback={<ProblemView kind={403} variant="module" labels={labels} homeHref={`/app/tenants/${tenantId}`} />}>
            {children}
          </ModuleGate>
        ) : (
          children
        )}
      </AskProvider>
      {demoRoutes ? <GuidedDemo words={Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("gd.")))} routes={demoRoutes} actions={{ run: runDemoStepAction.bind(null, tenantId) }} /> : null}
    </>
  );
}

/** The person's role and the workspace's name, read ONCE for the whole request: five questions in this layout ask for it, and each used to be its own call to the API. */
const tenantOf = cache(fetchTenant);

/** The assistant does the work in the chat (ASSISTANT_WORK_SCREENS): the mode and the person's role (the cards say "Only the owner can approve this"; the API checks again). Off, or a failed read: nothing. */
async function workFor(accessToken: string, tenantId: string): Promise<{ work?: { mode: "on" | "mock"; role: "owner" | "admin" | "sales" | "viewer" } }> {
  const mode = assistantWorkScreens(tenantId);
  if (mode === "off") return {};
  try {
    const role = (await tenantOf(accessToken, tenantId)).role;
    return role === "owner" || role === "admin" || role === "sales" || role === "viewer" ? { work: { mode, role } } : {};
  } catch {
    return {};
  }
}

/** The voice chat's settings for the people who may use it (Owner, Admin, Sales), or null. Its reads run together. */
async function voiceFor(token: string, tenantId: string, lang: Awaited<ReturnType<typeof getLang>>, dict: Record<string, string>, url: string) {
  if (!(await mayTalk(token, tenantId))) return null;
  const [audience, mayPronounce, profile, work, finderUpsell] = await Promise.all([
    chatAudience(token, tenantId),
    pronunciationScreens() !== "off" ? mayTurnOn(token, tenantId) : Promise.resolve(false),
    readMyProfileCached(token, tenantId).catch(() => null),
    workFor(token, tenantId),
    chatUpsell(token, tenantId),
  ]);
  return {
    words: withModuleWords(Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("bv.") || k.startsWith("vi.") || isChatCardWord(k))), audienceModules(audience)),
    url,
    language: isVoiceLang(lang) ? lang : ("en" as const),
    languageNames: Object.fromEntries(VOICE_LANGS.map((l) => [l, CALL_LANG_NAMES[l]])) as Record<(typeof VOICE_LANGS)[number], string>,
    tokenUrl: `/app/tenants/${tenantId}/voice-token`,
    speechUrl: `/app/tenants/${tenantId}/speech-transcribe`,
    pronunciation: mayPronounce,
    chatLanguage: profile?.preferredChatLanguage ?? null,
    chatLanguageUrl: `/app/tenants/${tenantId}/chat-language`,
    ...work,
    finderUpsell,
  };
}

/** Plan tiers (owner decision 4 Nov): in the chat, is a Lead Finder card the "Finding new customers is part of AI Workforce" card (a Lead Desk plan), and where does its link go (Settings -> Plan, for the Owner and Admin)? A failed read: the cards as before. */
async function chatUpsell(accessToken: string, tenantId: string): Promise<{ on: boolean; planHref: string | null }> {
  const planHref = upgradeHref(`/app/tenants/${tenantId}`, (await mayTurnOn(accessToken, tenantId)) ? "admin" : "sales");
  try {
    return { on: (await readFinderAccessCached(accessToken, tenantId)).access === "upsell", planHref };
  } catch {
    return { on: false, planHref };
  }
}

/** Whose words the chat's Lead Finder card speaks (a school's: organisations, C1 5 Nov). A failed read: the business words. */
async function chatAudience(accessToken: string, tenantId: string): Promise<Audience> {
  try {
    return (await readFinderAccessCached(accessToken, tenantId)).audience;
  } catch {
    return "businesses";
  }
}

/** May this person talk to the assistant by voice? Owner, Admin or Sales (the API checks again); a failed read is "no". */
async function mayTalk(accessToken: string, tenantId: string): Promise<boolean> {
  try {
    const role = (await tenantOf(accessToken, tenantId)).role;
    return role === "owner" || role === "admin" || role === "sales";
  } catch {
    return false;
  }
}

/** The screens of the guided demo's steps, when this workspace is a DEMO one and the person may run it (Owner or Admin); else nothing. A failed read is "no". */
async function demoRoutesFor(accessToken: string, tenantId: string, modules: readonly string[] | null) {
  try {
    const tenant = await tenantOf(accessToken, tenantId);
    if ((tenant.role !== "owner" && tenant.role !== "admin") || !(await readIsDemo(accessToken, tenantId, tenant.name))) return null;
    return routesFor(`/app/tenants/${tenantId}`, modules);
  } catch {
    return null;
  }
}

/** Whether the workspace is read-only. A read that fails says "not": the API refuses every change in that state all the same, so the worst case is a button that says so when pressed. */
async function workspaceAccess(accessToken: string, tenantId: string): Promise<Access> {
  try {
    return await readAccessCached(accessToken, tenantId);
  } catch {
    return { readOnly: false };
  }
}

/** May this person turn the assistant on for the workspace? Owner and Admin (the API checks again); a failed read of the role is "no", never a guess. */
async function mayTurnOn(accessToken: string, tenantId: string): Promise<boolean> {
  try {
    const role = (await tenantOf(accessToken, tenantId)).role;
    return role === "owner" || role === "admin";
  } catch {
    return false;
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
    const powers = powersOf((await tenantOf(accessToken, tenantId)).role);
    if (!powers.plan) return null;
    return { actions: boundTaskActions(tenantId), powers, words: Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tk.") || k.startsWith("pc.") || k.startsWith("dst.af.") || k === "dst.plan.ask_first")) };
  } catch {
    return null; // a failed role read: the switch is left out, never guessed
  }
}
