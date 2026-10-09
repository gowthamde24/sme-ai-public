import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppFrame } from "@/components/v2/app/AppFrame";
import type { Membership } from "@/components/v2/app/use-workspace";
import { fetchMe } from "@/lib/api/client";
import { requireUser } from "@/lib/auth/session";
import { LANG_COOKIE, THEME_COOKIE, readLang, readTheme } from "@/i18n/preferences";

import { signOut } from "./actions";

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
    const me = await fetchMe(user.accessToken);
    if (me.user_id === user.id) memberships = me.memberships.map((m) => ({ id: m.tenant.id, name: m.tenant.name, role: m.role }));
  } catch {
    // the API is down, or the session was rejected (the page then redirects to sign in): the account part only
  }
  return (
    <AppFrame lang={lang} theme={theme} email={user.email} memberships={memberships} signOut={signOut}>
      {children}
    </AppFrame>
  );
}
