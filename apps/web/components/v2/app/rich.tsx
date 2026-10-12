import { Fragment, type ReactNode } from "react";

import type { Say } from "./words";

/**
 * A translated sentence with parts that are not plain text (job BK): the dictionary text keeps `{name}` markers where a bold value, a link or a time goes, and `with` says what to put there. A marker with no
 * entry is left visible (so a missing piece is noticed, not hidden). The order of the parts can change from one language to the next, which is why a sentence is one key and not several pieces around the values.
 */
export function Rich({ t, k, with: parts = {}, vars }: { t: Say; k: string; with?: Record<string, ReactNode>; vars?: Record<string, string | number> }) {
  const pieces = t(k, vars).split(/(\{\w+\})/);
  return (
    <>
      {pieces.map((piece, i) => {
        const name = /^\{(\w+)\}$/.exec(piece)?.[1];
        return name !== undefined && name in parts ? <Fragment key={i}>{parts[name]}</Fragment> : <Fragment key={i}>{piece}</Fragment>;
      })}
    </>
  );
}
