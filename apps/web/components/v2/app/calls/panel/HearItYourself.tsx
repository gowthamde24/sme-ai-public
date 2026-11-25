"use client";

import { Mic } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { primeAudio } from "@/lib/browser-voice/audio-io";

import { TalkLiveBody } from "../../ds/talk/TalkLive";
import { useTalkLive } from "../../ds/talk/use-talk-live";
import { btnMain } from "../../ui";
import { makeT, type Words } from "../../words";

/**
 * "Hear it yourself" on the Calls page (owner, 29 Nov 2026; approved mock "Calls"): talk to the assistant in this browser, the way a customer would on the phone (the browser-voice socket in "practice" mode, the same one as My assistant > Practice). Nobody is dialled and nothing is sent.
 * One boxed card (it is a thing you start): a bare line microphone in the calls colour, one line of what it does, ONE button "Start a test call". While it runs the conversation is drawn in place (the same body as Practice); "Type" goes to My assistant, where the typed practice lives. The
 * microphone is asked for in the tap (Safari). Only where BROWSER_VOICE is on (the page decides). The words come from the string store (`cpn.hear.`, and the talk body's own `dst.`, `bv.`).
 */
export function HearItYourself({ words, language, base }: { words: Words; /** the app's language, named in itself, for the talk body's "listening in ..." line */ language: string; base: string }) {
  const t = makeT(words);
  const router = useRouter();
  const live = useTalkLive("practice");
  const { finished, end } = live;
  React.useEffect(() => {
    if (finished) end(); // the conversation ended in a normal way (the person said bye): the card goes back to its button
  }, [finished, end]);
  const start = () => {
    primeAudio(); // the microphone is asked for IN this tap
    live.start();
  };
  return (
    <section data-part="hear-it-yourself" aria-label={t("cpn.hear.title")} className="min-w-0 rounded-[14px] border border-line bg-surface p-4 sm:px-[18px]">
      {live.active ? (
        <TalkLiveBody
          live={live}
          words={words}
          language={language}
          onType={() => {
            live.end();
            router.push(`${base}/my-assistant`);
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-4 max-sm:flex-col max-sm:items-stretch">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <Mic aria-hidden="true" data-k="call" className="mt-0.5 size-[26px] shrink-0" strokeWidth={1.8} />
            <div className="min-w-0">
              <h2 className="m-0 font-display text-[17px] font-bold text-ink">
                {t("cpn.hear.title")}
              </h2>
              <p className="m-0 text-[15px] text-muted">{t("cpn.hear.text")}</p>
            </div>
          </div>
          <button type="button" onClick={start} data-part="hear-start" className={`${btnMain} max-sm:w-full`}>
            {t("cpn.hear.start")}
          </button>
        </div>
      )}
    </section>
  );
}
