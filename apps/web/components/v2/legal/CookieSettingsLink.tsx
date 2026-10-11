"use client";

import { openCookieSettings } from "@/lib/consent/store";

/** The "Cookie settings" entry of every footer: opens the settings panel (components/v2/legal/CookieConsent.tsx, mounted once in the root layout). A button, not a link: it does not navigate. */
export function CookieSettingsLink({ label, className }: { label: string; className?: string }) {
  return (
    <button type="button" onClick={openCookieSettings} className={className}>
      {label}
    </button>
  );
}
