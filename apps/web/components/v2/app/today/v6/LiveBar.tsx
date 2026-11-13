"use client";

import * as React from "react";

import { TalkLiveBody } from "../../ds/talk/TalkLive";
import type { TalkKind } from "../../ds/talk/script";
import { useTalkLive } from "../../ds/talk/use-talk-live";
import type { Words } from "../../words";

/**
 * The live conversation inside the command bar (design system v6): starts the moment it is drawn (the person tapped the orb) and is drawn only then, so it is a lazy chunk (`LazyLiveBar`) that Today's first paint does not carry. End returns the bar to normal; "Type" returns to the input. The voice is mocked on staging.
 */
export default function LiveBar({ kind = "command", words, language, onClose }: { kind?: TalkKind; words: Words; language: string; /** The bar goes back to normal (End or Type). */ onClose: (via: "end" | "type") => void }) {
  const live = useTalkLive(kind);
  const { start, end } = live;
  React.useEffect(() => {
    start();
    return end;
  }, [start, end]);
  return (
    <TalkLiveBody
      live={{ ...live, end: () => { end(); onClose("end"); } }}
      words={words}
      language={language}
      onType={() => {
        end();
        onClose("type");
      }}
    />
  );
}
