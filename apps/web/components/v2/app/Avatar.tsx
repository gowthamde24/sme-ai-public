"use client";

import { useState } from "react";

/**
 * The round mark of a person: their picture when there is one (their own, or the Google one) and the first letters when there is none or it cannot be loaded. `letters` are drawn by the caller (from the name, else the e-mail address).
 * The picture is decoration next to the name, so it has no text of its own.
 */
export function Avatar({ url, letters, className }: { url: string | null; letters: string; className: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span aria-hidden="true" className={`${className} overflow-hidden`}>
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed link into the project's own Storage or Google's photo address (both named in img-src), shown as it is
        <img src={url} alt="" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        letters
      )}
    </span>
  );
}
