"use client";

import { Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { control } from "@/components/v2/landing/ui";
import { LANGS, LANGUAGE_NAMES, type Lang } from "@/i18n/lang";
import { LANG_COOKIE, readLang, serializePreference } from "@/i18n/preferences";

/**
 * The language control. It writes the functional cookie `sme_lang` and asks the server to render the page again; the
 * response is already in the chosen language (no client-side dictionary, no flash). `label` comes from the server.
 */
export function LangSelect({ lang, label, landingRoutes = false }: { lang: Lang; label: string; /** On the public page the choice is also an address ("/", "/te", "/hi", "/kn"), so a language has a link that can be shared and found. */ landingRoutes?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState<Lang>(lang);
  const [, startTransition] = useTransition();
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <Globe className="pointer-events-none absolute left-2.5 size-4 text-muted sm:left-3" aria-hidden="true" />
      <select
        value={value}
        onChange={(e) => {
          const next = readLang(e.target.value);
          setValue(next);
          document.cookie = serializePreference(LANG_COOKIE, next, window.location.protocol === "https:");
          const address = next === "en" ? "/" : `/${next}`;
          startTransition(() => (landingRoutes && ["/", "/te", "/hi", "/kn"].includes(window.location.pathname) && window.location.pathname !== address ? router.push(address) : router.refresh()));
        }}
        className={`${control} shrink-0 appearance-none pl-8 pr-2 text-sm font-medium sm:pl-9 sm:pr-3`}
      >
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_NAMES[l].native}
          </option>
        ))}
      </select>
    </label>
  );
}
