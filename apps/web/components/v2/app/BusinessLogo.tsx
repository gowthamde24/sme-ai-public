"use client";

import { useState } from "react";

/** The letters of a business name for its avatar: the first letter of its first two words ("Neelambari Silks" -> "NS"), in capitals; "?" for a name with no letters. */
export function initialsOf(name: string): string {
  const words = name.replace(/\(.*?\)/g, " ").split(/[\s\-_.,]+/).filter((w) => /\p{L}/u.test(w));
  const letters = words.slice(0, 2).map((w) => Array.from(w.replace(/^[^\p{L}]+/u, ""))[0] ?? "");
  return (letters.join("") || "?").toLocaleUpperCase();
}

/**
 * The business's own mark at the top of the menu (owner 31 Oct): the logo it uploaded (Settings > Business > Logo), or, with none (or one that cannot be loaded), a letter avatar of the business name in the brand colours. `px` is the size.
 * The picture is a signed address: the next page load brings a fresh one, so a logo that has just been uploaded shows at once (the layout reads the profile again) and an expired one falls back to the letters.
 */
export function BusinessLogo({ name, url, px = 40 }: { name: string; url: string | null; px?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const size = px >= 40 ? "size-10 text-base" : "size-8 text-sm";
  if (url && failed !== url) {
    // eslint-disable-next-line @next/next/no-img-element -- a signed address of the business's own picture: next/image would proxy it
    return <img src={url} alt="" data-business-logo="image" onError={() => setFailed(url)} className={`${size} shrink-0 rounded-lg border border-line bg-surface object-contain`} />;
  }
  return (
    <span data-business-logo="letters" aria-hidden="true" className={`${size} grid shrink-0 place-items-center rounded-lg bg-brand font-display font-bold text-on-brand`}>
      {initialsOf(name)}
    </span>
  );
}
