"use client";

import { type ScreenTip, useRegisterTip } from "./help-store";

/**
 * The "?" tip of a screen (job BT; moved to the top bar 31 Oct): the screen hands its three short lines and the link to its full guide to the "?" button in the header (components/v2/app/help/HelpButton.tsx), which opens them under itself. Nothing is
 * drawn in the page any more (it used to be a "Help for this screen" button under the heading). The words arrive resolved in the person's language (components/v2/app/help/help-tip.tsx).
 */
export function HelpTip(props: ScreenTip) {
  useRegisterTip(props);
  return null;
}
