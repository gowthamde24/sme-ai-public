import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Suspense, type ReactNode } from "react";

import { AppFrame, MARK_LARGE, MARK_SMALL } from "@/components/v2/app/AppFrame";
import { Avatar } from "@/components/v2/app/Avatar";
import { lettersOf } from "@/components/v2/app/letters";
import { FRAME_LOADING, type FrameData } from "@/components/v2/app/contract";
import { appV4, designV6, jobsScreens } from "@/lib/screens/flag";
import { workspaceOf } from "@/components/v2/app/nav";
import type { Membership } from "@/components/v2/app/use-workspace";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { mark, timed } from "@/lib/observe/server-timing";
import { ServerTimingReport } from "@/lib/observe/ServerTimingReport";
import { serverTimingOn } from "@/lib/observe/timing-format";
import { demoVideoAllowed, requestVideoAddress } from "@/lib/demo-video/guard";
import { BUSINESS } from "@/lib/demo-video/fixtures";
import { readPackCached } from "@/lib/packs/read";
import { packFrame } from "@/lib/packs/resolve";
import { LANG_COOKIE, THEME_COOKIE, readLang, readTheme } from "@/i18n/preferences";

import { signOut } from "./actions";
import { readMeCached, readMyProfileCached } from "./me-read";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The frame of every screen under /app (workspace redesign, Batch 1A). Frame only: it decides no access (the pages, the API and the database do) and
 * changes no page. It reads the signed-in person and the memberships (`/v1/me`) to draw the menu; if the API cannot be read it draws the account part
 * only and the page shows its own error. A person with no session is sent to sign in, exactly as the pages do. The workspace switcher opens the create form of
 * /app (unchanged, same action) in place, so the form is handed to the frame as a slot.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const jar = await cookies();
  const lang = readLang(jar.get(LANG_COOKIE)?.value);
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  let memberships: Membership[] | null = null;
  // the workspace of the address (the proxy records where the person is, so the first paint already has the right menu): its pack and the person's own profile do not need the answer of `/v1/me` to be ASKED, only to be DRAWN, so they start NOW, together with it (C2, 19 Nov 2026: they were asked after it,
  // one round trip more before the first byte of every page). What `/v1/me` says is only checked afterwards: a workspace the person is not in draws nothing of them (the API refused those reads, and a refusal is swallowed exactly as before).
  const hereId = await workspaceInAddress();
  const frameReads = hereId
    ? Promise.all([timed("app_pack", () => readPackCached(user.accessToken, hereId)), timed("app_profile", () => readMyProfileCached(user.accessToken, hereId).catch(() => null))])
    : null;
  void frameReads?.catch(() => undefined); // (a rejection that arrives while /v1/me is still awaited is not lost: it is read, and swallowed, below)
  try {
    const me = await timed("app_me", () => readMeCached(user.accessToken));
    if (me.user_id === user.id) memberships = me.memberships.map((m) => ({ id: m.tenant.id, name: m.tenant.name, role: m.role }));
  } catch {
    // the API is down, or the session was rejected (the page then redirects to sign in): the account part only
  }
  // app v4 is an environment switch, so the first paint knows it (without it the phone's header and section tabs were drawn the old way and re-drawn when the workspace's layout handed the data over: a 68 px jump)
  let frame: FrameData = { ...FRAME_LOADING, v4: appV4(), ds: designV6(), jobs: jobsScreens() !== "off" };
  let me: { url: string | null; letters: string } | null = null;
  try {
    if (frameReads && hereId && memberships?.some((m) => m.id.toLowerCase() === hereId.toLowerCase())) {
      const [pack, mine] = await frameReads;
      if (pack) frame = { ...frame, pack: packFrame(pack, lang) };
      if (mine) me = { url: mine.pictureUrl, letters: lettersOf(mine.displayName, user.email) };
    }
  } catch {
    // no pack to draw: the menu the product always had
  }
  // the demo-video mode (job demo-video, lib/demo-video/guard.ts): the frame names the story's invented business and person (no plan line, a bell that asks nothing), never the demo workspace's own name ("DEMO ... (synthetic)") or the demo account's address
  const video = await videoFrame(user.accessToken, memberships);
  if (video) {
    memberships = video.memberships;
    me = { url: null, letters: BUSINESS.letters };
  }
  // the person's own picture over their letters, drawn here on the server and handed to the menu as slots (no script of their own)
  const avatar = me ? <Avatar url={me.url} letters={me.letters} className={MARK_SMALL} /> : undefined;
  const avatarLarge = me ? <Avatar url={me.url} letters={me.letters} className={MARK_LARGE} /> : undefined;
  mark("app_shell"); // (SERVER_TIMING=1 only) everything above the first Suspense is read: this is where the first bytes of the page can go
  return (
    <>
      <AppFrame lang={lang} theme={theme} email={video ? null : user.email} memberships={memberships} signOut={signOut} frame={frame} mark={avatar} markLarge={avatarLarge} still={video !== null}>
        {children}
      </AppFrame>
      {/* SERVER_TIMING=1 (staging only): the render's spans, in a Suspense of their own at the end of the stream (lib/observe/ServerTimingReport.tsx) */}
      {serverTimingOn() ? (
        <Suspense fallback={null}>
          <ServerTimingReport />
        </Suspense>
      ) : null}
    </>
  );
}

/** The workspace of the address the proxy recorded (`x-sme-path`), when it is one; none outside a request (a test) or for any other page. */
async function workspaceInAddress(): Promise<string | null> {
  try {
    const here = workspaceOf(((await headers()).get("x-sme-path") ?? "").split("?")[0]);
    return here && isCanonicalUuid(here.tenantId) ? here.tenantId : null;
  } catch {
    return null;
  }
}

/** In the demo-video mode (and only there: the guard said yes for the workspace of this address), the memberships as the frame draws them: that workspace alone, named as the story's business. null = not the mode. */
async function videoFrame(accessToken: string, memberships: Membership[] | null): Promise<{ memberships: Membership[] } | null> {
  const asked = await requestVideoAddress();
  if (!asked || !memberships?.some((m) => m.id.toLowerCase() === asked.tenantId.toLowerCase()) || !(await demoVideoAllowed(accessToken, asked.tenantId))) return null;
  // only that workspace: the switcher does not list the account's other (demo) workspaces in the recording
  return { memberships: memberships.filter((m) => m.id.toLowerCase() === asked.tenantId.toLowerCase()).map((m) => ({ ...m, name: BUSINESS.name })) };
}
