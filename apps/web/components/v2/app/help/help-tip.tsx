import { appT, type AppKey } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

import { HelpTip } from "./HelpTip";
import { TIP_LINES, TIP_SCREENS, type TipScreen } from "./guides";

/**
 * The "?" tip of one screen, with its words resolved on the server in the person's language (job BT). `base` is the workspace path (/app/tenants/<id>). Draw it right under the screen's heading.
 * The three lines of a screen about what was sent or blocked (the Outbox) are English in every language, like their guide.
 */
export function helpTipFor(lang: Lang, base: string, screen: TipScreen) {
  const t = appT(lang);
  const lines = Array.from({ length: TIP_LINES }, (_, i) => t(`help.tip.${screen}.${i + 1}` as AppKey));
  return (
    <HelpTip
      screen={screen}
      label={t("help.tip.label")}
      lines={lines}
      moreHref={`${base}/help/${TIP_SCREENS[screen]}`}
      moreLabel={t("help.tip.more")}
      closeLabel={t("help.tip.close")}
    />
  );
}
