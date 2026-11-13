import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { AppFrame, MARK_LARGE, MARK_SMALL } from "@/components/v2/app/AppFrame";
import { Avatar } from "@/components/v2/app/Avatar";
import { lettersOf } from "@/components/v2/app/letters";
import { FRAME_LOADING, type FrameData } from "@/components/v2/app/contract";
import { appV4, designV6 } from "@/lib/screens/flag";
import { workspaceOf } from "@/components/v2/app/nav";
import type { Membership } from "@/components/v2/app/use-workspace";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
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
  try {
    const me = await readMeCached(user.accessToken);
    if (me.user_id === user.id) memberships = me.memberships.map((m) => ({ id: m.tenant.id, name: m.tenant.name, role: m.role }));
  } catch {
    // the API is down, or the session was rejected (the page then redirects to sign in): the account part only
  }
  // the menu of THIS workspace's business type (job CL): the proxy records where the person is, so the first paint already has the right menu (the workspace's own layout hands the same to the client store)
  // app v4 is an environment switch, so the first paint knows it (without it the phone's header and section tabs were drawn the old way and re-drawn when the workspace's layout handed the data over: a 68 px jump)
  let frame: FrameData = { ...FRAME_LOADING, v4: appV4(), ds: designV6() };
  let me: { url: string | null; letters: string } | null = null;
  try {
    const here = workspaceOf(((await headers()).get("x-sme-path") ?? "").split("?")[0]);
    if (here && isCanonicalUuid(here.tenantId) && memberships?.some((m) => m.id.toLowerCase() === here.tenantId.toLowerCase())) {
      const [pack, mine] = await Promise.all([readPackCached(user.accessToken, here.tenantId), readMyProfileCached(user.accessToken, here.tenantId).catch(() => null)]);
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
  const mark = me ? <Avatar url={me.url} letters={me.letters} className={MARK_SMALL} /> : undefined;
  const markLarge = me ? <Avatar url={me.url} letters={me.letters} className={MARK_LARGE} /> : undefined;
  return (
    <AppFrame lang={lang} theme={theme} email={video ? null : user.email} memberships={memberships} signOut={signOut} frame={frame} mark={mark} markLarge={markLarge} still={video !== null}>
      {children}
    </AppFrame>
  );
}

/** In the demo-video mode (and only there: the guard said yes for the workspace of this address), the memberships as the frame draws them: that workspace alone, named as the story's business. null = not the mode. */
async function videoFrame(accessToken: string, memberships: Membership[] | null): Promise<{ memberships: Membership[] } | null> {
  const asked = await requestVideoAddress();
  if (!asked || !memberships?.some((m) => m.id.toLowerCase() === asked.tenantId.toLowerCase()) || !(await demoVideoAllowed(accessToken, asked.tenantId))) return null;
  // only that workspace: the switcher does not list the account's other (demo) workspaces in the recording
  return { memberships: memberships.filter((m) => m.id.toLowerCase() === asked.tenantId.toLowerCase()).map((m) => ({ ...m, name: BUSINESS.name })) };
}
