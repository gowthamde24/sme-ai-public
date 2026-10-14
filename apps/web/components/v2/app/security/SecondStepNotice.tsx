import Link from "next/link";

import type { AppT } from "@/i18n/app";

import { card, help, secondary } from "../visits/styles";

/**
 * "This needs your second step first" (job CL on top of `GET /v1/account/security`, job CK): the second factor is NOT asked at sign-up, it is asked before the first real money action and before WhatsApp is
 * connected. A person still at the first level who is about to do something that needs it is told why and given the way to Security, instead of meeting a refusal after pressing the button. Drawn only when the
 * server says the session is at the first level and names this group of actions; the database refuses the action regardless (SM306). A server component with a plain link.
 */
export function SecondStepNotice({ message, t }: { message: string; t: AppT }) {
  return (
    <section role="note" data-notice="second-step" className={`${card} gap-3 border-amber-text bg-amber-bg`}>
      <p className={help}>{message}</p>
      <div>
        <Link href="/app/security" className={secondary}>
          {t("sec.notice.link")}
        </Link>
      </div>
    </section>
  );
}
