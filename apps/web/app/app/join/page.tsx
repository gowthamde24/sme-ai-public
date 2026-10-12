import { JoinForm } from "@/components/v2/app/team/JoinForm";
import { pageMain } from "@/components/v2/app/ui";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { requireUser } from "@/lib/auth/session";

import { acceptInvitationAction } from "./actions";

export const metadata = { title: "Join a business · SME AI Revenue Engine", referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

/**
 * /app/join (job CC): where a person who was given an invitation code enters it. The page is served with `Referrer-Policy: no-referrer` (next.config.ts) so that nothing leaves it in a Referer header, and the code, if the
 * link carried one after the "#", is moved into the box and out of the address bar by the form.
 */
export default async function JoinPage() {
  await requireUser();
  const lang = await getLang();
  return (
    <main className={pageMain} lang={lang}>
      <div className="mx-auto max-w-xl">
        <JoinForm words={wordsFor(lang, ["team.join.", "apierr.", "team.err."], ["dta.btn.working"])} accept={acceptInvitationAction} />
      </div>
    </main>
  );
}
