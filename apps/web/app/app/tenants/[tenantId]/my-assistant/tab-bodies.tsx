import { AboutBusiness } from "@/components/v2/app/assistant/LazyAboutBusiness";
import { AutoReply } from "@/components/v2/app/assistant/LazyAutoReply";
import { CallSettingsAdvanced } from "@/components/v2/app/assistant/LazyCallSettingsAdvanced";
import { EmptyNext } from "@/components/v2/app/ds/EmptyNext";
import { sentenceForms, settingsOpen } from "@/lib/screens/flag";
import { CallLimitCard, KnowledgeStep, TalkToYou, VoiceCard, VoiceTone } from "@/components/v2/app/my-assistant/LazyMyAssistant";
import { Section } from "@/components/v2/app/my-assistant/Section";
import { tabHref } from "@/components/v2/app/my-assistant/tabs";
import { surface } from "@/components/v2/app/ui";
import { appDict } from "@/i18n/app";
import { wordsFor } from "@/i18n/app-words";
import type { Lang } from "@/i18n/lang";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { offeredLangs } from "@/lib/languages";
import { currentAssistantName } from "@/lib/assistant/name";
import { appV4, moreLanguages, autoReplyScreens, callSettingsScreens, jobsScreens, openingLineScreens, voicePickerScreens, myAssistantOpen } from "@/lib/screens/flag";
import { OpenTabs } from "@/components/v2/app/my-assistant/OpenTabs";

import { setAutoReplyAction } from "../auto-reply-actions";
import { saveCallSettingsAction } from "../call-settings-actions";
import { previewOpeningLineAction } from "../opening-line-actions";
import { saveTalkTrainingAction, resetTalkTrainingAction } from "../talk-training-actions";
import { chooseVoiceAction, hearVoiceAction, toneExampleAction } from "../voice-picker-actions";
import { saveCallLimitAction } from "../call-limit-actions";
import { loadTalkPrefsAction, previewTalkPrefsAction, saveTalkPrefsAction, undoTalkPrefsAction } from "../talk-prefs-actions";
import { addFactAction, addFileAction, addPasteAction, decideFactAction, discardSourceAction, draftFactsAction, editFactAction } from "../lead-setup-actions";
import { saveSpeaksAction } from "../ai-team/training/speaks-actions";
import { SpeedToLead } from "@/components/v2/app/assistant/LazySpeedToLead";
import { saveSpeedRulesAction } from "../outreach-actions";
import type { readKnowledgeTab, readRulesTab, readVoiceTab } from "./my-assistant-data";

type Say = (key: string, vars?: Record<string, string | number>) => string;
type Common = { lang: Lang; t: Say; tenantId: string; base: string; owner: boolean };

/** (These are plain functions the page CALLS, not components: they read the screen flags, and a flag is read when the page is built.)
 * Knowledge: business details, catalogue and prices, questions and answers, price list, website. The cards of parts that live on their own page link there; the rest are the working parts of Settings and the Lead Desk setup, reused as they are. */
export function knowledgeTab({ lang, t, tenantId, base, owner, data, business }: Common & { data: Awaited<ReturnType<typeof readKnowledgeTab>>; business: string }) {
  const nothing = !data.about && !data.knowledge;
  return (
    <div className="flex flex-col gap-4" data-part="mya-knowledge">
      <p className="m-0 text-base text-muted">{t("mya.k.sub")}</p>
      {nothing ? <EmptyNext title={t("mya.k.empty.t")} text={t("mya.k.empty.d")} action={{ href: `${base}/catalogue`, label: t("mya.k.empty.go") }} /> : null}
      <Section id="profile" title={t("mya.k.profile.t")} text={t("mya.k.profile.d")} link={{ href: `${base}/settings?section=business`, label: t("mya.k.profile.go") }} />
      {data.about ? (
        <div id="about">
          <AboutBusiness words={wordsFor(lang, ["ctx."])} initial={data.about} endpoint={`${base}/context`} canEdit lang={lang} sourcesHref={`${base}/lead-sources`} />
        </div>
      ) : null}
      <Section id="catalogue" title={t("mya.k.catalogue.t")} text={t("mya.k.catalogue.d")} link={{ href: `${base}/catalogue`, label: t("mya.k.catalogue.go") }} />
      <Section id="pricelist" title={t("mya.k.pricelist.t")} text={t("mya.k.pricelist.d")} link={{ href: `${base}/price-list`, label: t("mya.k.pricelist.go") }} />
      {data.knowledge ? (
        <Section id="faq" title={t("mya.k.faq.t")} text={t("mya.k.faq.d")}>
          <KnowledgeStep
            words={wordsFor(lang, ["ld.k.", "ld.wiz.", "pc."])}
            sources={data.knowledge.sources}
            facts={data.knowledge.facts}
            canPrice={owner}
            securityHref="/app/security"
            nextHref={tabHref(base, "voice")}
            actions={{ addPaste: addPasteAction.bind(null, tenantId), addFile: addFileAction.bind(null, tenantId), draft: draftFactsAction.bind(null, tenantId), addFact: addFactAction.bind(null, tenantId), edit: editFactAction.bind(null, tenantId), decide: decideFactAction.bind(null, tenantId), discard: discardSourceAction.bind(null, tenantId) }}
          />
        </Section>
      ) : null}
      <Section id="website" title={t("mya.k.website.t")} text={t("mya.k.website.d")} link={{ href: data.knowledge ? "#faq" : `${base}/lead-sources`, label: t("mya.k.website.go") }} />
    </div>
  );
}

/** The tones in the words of each voice language, whatever language the app is in: the example under "How it talks" is written in the language of the voice that is picked. */
/** One order of the language chips everywhere on this tab (owner's audit, 24 Nov: three different orders on one page): Telugu, Hindi, Kannada, English. */
const CHIP_ORDER: readonly string[] = ["te", "hi", "kn", "en"];
const inOneOrder = <L extends string>(list: readonly L[]): L[] => [...list].sort((a, b) => (CHIP_ORDER.indexOf(a) + 1 || 99) - (CHIP_ORDER.indexOf(b) + 1 || 99));
const EXAMPLE_LANGS = ["te", "hi", "kn", "en"] as const satisfies readonly Lang[];
const TONE_WORDS = ["friendly", "respectful", "quick"] as const;
/** The real two-sided sample calls of this business type (customer line, assistant line, ...), per language and tone, from the words file; a type with none gets the default ones. */
function toneConversations(pack: string | null): Record<string, Record<(typeof TONE_WORDS)[number], string[]>> {
  // the samples are words (vc.cv.<business type>.<tone>); a type that has none gets vc.cv.default.<tone>
  const p = pack && `vc.cv.${pack}.friendly` in (appDict("en") as Record<string, string>) ? pack : "default";
  return Object.fromEntries(EXAMPLE_LANGS.map((l) => [l, Object.fromEntries(TONE_WORDS.map((x) => [x, String((appDict(l) as Record<string, string>)[`vc.cv.${p}.${x}`] ?? "").split("\n").filter(Boolean)]))])) as Record<string, Record<(typeof TONE_WORDS)[number], string[]>>;
}
function toneExamples(): Record<string, Record<(typeof TONE_WORDS)[number], string>> {
  return Object.fromEntries(EXAMPLE_LANGS.map((l) => [l, Object.fromEntries(TONE_WORDS.map((x) => [x, (appDict(l) as Record<string, string>)[`vc.ex.${x}`] ?? ""]))])) as Record<string, Record<(typeof TONE_WORDS)[number], string>>;
}

/** Voice & tone: TWO plain cards (owner, 20 Nov 2026: "one simple card"). 1. "Your assistant's voice": a row of named voices for each language, how it talks (three choices and one example), the background, the "Say 'AI assistant' when greeting" switch and the test call. 2. "Greeting and more choices": the greeting in one box, and More choices under it. Then, with "How it talks to you" on, the person's own choices. */
export function voiceTab({ lang, t, tenantId, base, owner, data, business, ownerFirst = null, testCallHref = null, pack = null }: Common & { data: Awaited<ReturnType<typeof readVoiceTab>>; business: string; ownerFirst?: string | null; testCallHref?: string | null; pack?: string | null }) {
  const { picker, training, speaks } = data;
  const words = wordsFor(lang, ["tt.", "bv.end.", "sp.", "vt."], ["today.err.mfa.link", "ope.preview", "vp.mock", "vp.err.sample", "vp.owneronly"]);
  const cardWords = wordsFor(lang, ["vc.", "sp.err."], ["today.err.mfa.link", "vp.mock", "vp.err.sample", "vp.owneronly", "vp.none", "vp.recommended", "vt.lang", "vt.voice", "vt.play", "vt.stop", "vt.ex.label", "vt.hear.none", "sp.notsaved", "mya.v.selected"]);
  // with "How it talks to you" on, the tab has two parts: how it talks to customers (the cards) and how it talks to the person
  const you = data.talk ? (
    <TalkToYou
      words={wordsFor(lang, ["otp.", "vt."])}
      initial={data.talk.prefs.data}
      languages={data.talk.languages}
      first={data.talk.first}
      langNames={CALL_LANG_NAMES}
      mock={data.talk.prefs.mock}
      ownerFirst={ownerFirst}
      plain={settingsOpen()}
      actions={{ load: loadTalkPrefsAction.bind(null, tenantId), save: saveTalkPrefsAction.bind(null, tenantId), undo: undoTalkPrefsAction.bind(null, tenantId), preview: previewTalkPrefsAction.bind(null, tenantId) }}
    />
  ) : null;
  const first = data.languages[0] ?? "te";
  const pickerOn = picker && voicePickerScreens() !== "off" ? picker : null;
  // the name of the voice that speaks in each language now (the greeting's "Hear it" says it)
  const voiceNames: Partial<Record<string, string>> = {};
  if (pickerOn) for (const l of data.languages) voiceNames[l] = pickerOn.voices.find((v) => v.id === pickerOn.active[l] && v.language === l)?.name ?? pickerOn.voices.find((v) => v.language === l && v.gender === pickerOn.gender && (v.id === pickerOn.choices[l] || (!pickerOn.choices[l] && v.isDefault)))?.name;
  const speaksPanel = speaks ? { ...speaks, save: saveSpeaksAction.bind(null, tenantId) } : null;
  const cards = (
    <>
      {!picker && !training && !speaks ? <EmptyNext title={t("mya.v.empty.t")} text={t("mya.v.empty.d")} action={{ href: `${base}/settings?section=assistant`, label: t("mya.v.empty.go") }} /> : null}
      <VoiceCard
        words={cardWords}
        uiLang={lang}
        picker={pickerOn ? { voices: pickerOn.voices, choices: pickerOn.choices, active: pickerOn.active, gender: pickerOn.gender, fake: pickerOn.fake } : null}
        languages={inOneOrder(data.languages)}
        first={first}
        langNames={CALL_LANG_NAMES}
        endpoint={`${base}/voice-pick`}
        choose={chooseVoiceAction.bind(null, tenantId)}
        hear={pickerOn ? hearVoiceAction.bind(null, tenantId) : null}
        speaks={speaksPanel}
        examples={toneExamples()}
        conversations={toneConversations(pack)}
        open={myAssistantOpen()}
        draftLangs={["te", "hi", "kn"]}
        toneExample={pickerOn && voicePickerScreens() === "on" ? toneExampleAction.bind(null, tenantId) : null}
        canEdit
        securityHref="/app/security"
        testCallHref={testCallHref}
      />
      {myAssistantOpen() ? (
        <details data-part="mya-more" className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 border-t border-line pt-3 text-[15px] font-semibold text-muted">{t("mya.open.more")}</summary>
          <div className="mt-3">
            <VoiceTone
              words={words}
              voiceNames={voiceNames}
              first={first}
              training={training}
              actions={{ save: saveTalkTrainingAction.bind(null, tenantId), reset: resetTalkTrainingAction.bind(null, tenantId) }}
              canEdit={owner}
              securityHref="/app/security"
              speaks={speaksPanel}
              offered={offeredLangs(moreLanguages())}
              langNames={CALL_LANG_NAMES}
              business={business}
              assistantName={currentAssistantName()}
              hearIt={openingLineScreens() !== "off" ? previewOpeningLineAction.bind(null, tenantId) : null}
              sayAi={data.opening ? data.opening.mentionAi : (speaks?.initial.sayAi?.value ?? null)}
              suggested={data.opening?.defaults ?? null}
              v4={appV4()}
            />
          </div>
        </details>
      ) : (
      <VoiceTone
        words={words}
        voiceNames={voiceNames}
        first={first}
        training={training}
        actions={{ save: saveTalkTrainingAction.bind(null, tenantId), reset: resetTalkTrainingAction.bind(null, tenantId) }}
        canEdit={owner}
        securityHref="/app/security"
        speaks={speaksPanel}
        offered={offeredLangs(moreLanguages())}
        langNames={CALL_LANG_NAMES}
        business={business}
        assistantName={currentAssistantName()}
        hearIt={openingLineScreens() !== "off" ? previewOpeningLineAction.bind(null, tenantId) : null}
        sayAi={data.opening ? data.opening.mentionAi : (speaks?.initial.sayAi?.value ?? null)}
        suggested={data.opening?.defaults ?? null}
        v4={appV4()}
      />
      )}
    </>
  );
  if (myAssistantOpen())
    return (
      <div data-part="mya-voice">
        <OpenTabs customers={cards} you={you} labels={{ customers: t("mya.open.customers"), you: t("mya.open.you"), tabs: t("mya.open.tabs"), customersCap: t("mya.open.customers.cap"), youCap: t("mya.open.you.cap") }} />
      </div>
    );
  return (
    <div className="flex flex-col gap-4" data-part="mya-voice">
      {cards}
      {you}
    </div>
  );
}

/** Rules: automatic replies (the auto-send policy), calling hours and put-through-to-you rules (the call settings), and listening in / taking over: the working parts of Settings > AI assistant, reused as they are. */
export function rulesTab({ lang, t, tenantId, base, owner, data }: Common & { data: Awaited<ReturnType<typeof readRulesTab>> }) {
  const { autoReply, callSettings, callLimit, speed } = data;
  const any = autoReply?.mode === "ok" || callSettings?.mode === "ok" || callLimit?.mode === "ok" || !!speed;
  return (
    <div className="flex flex-col gap-4" data-part="mya-rules">
      <p className="m-0 text-base text-muted">{t("mya.r.sub")}</p>
      {!any ? <EmptyNext title={t("mya.r.empty.t")} text={t("mya.r.empty.d")} action={{ href: `${base}/settings?section=assistant`, label: t("mya.r.empty.go") }} /> : null}
      {autoReply?.mode === "ok" && autoReplyScreens() !== "off" ? <AutoReply words={wordsFor(lang, ["ar."], ["today.err.mfa.link"])} initial={autoReply.data} canEdit={owner} change={setAutoReplyAction.bind(null, tenantId)} securityHref="/app/security" /> : null}
      {callSettings?.mode === "ok" && callSettingsScreens() !== "off" ? (
        <CallSettingsAdvanced
          words={wordsFor(lang, ["calls.", ...(jobsScreens() !== "off" ? ["jobs.rules."] : [])], ["asst.hours.from", "asst.hours.to", "asst.hours.t", ...["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => `asst.day.${d}`), "today.err.mfa", "today.err.mfa.link"])}
          initial={callSettings.settings}
          locked={callSettings.lockedPurposes}
          canEdit={owner}
          mock={callSettingsScreens() === "mock"}
          simple={sentenceForms()}
          saved={callSettings.saved}
          actions={{ save: saveCallSettingsAction.bind(null, tenantId) }}
        />
      ) : null}
      {speed ? (
        <SpeedToLead
          words={wordsFor(lang, ["stl."], ["today.err.mfa.link", ...["website", "missed_calls", "meta", "click_to_whatsapp", "indiamart", "email_forward", "google_ads", "sheets"].map((k) => `sc.${k}`)])}
          initial={speed}
          canEdit={owner}
          save={saveSpeedRulesAction.bind(null, tenantId)}
          securityHref="/app/security"
        />
      ) : null}
      {callLimit?.mode === "ok" ? <CallLimitCard words={wordsFor(lang, ["cl."], ["dst.af.back"])} initial={callLimit.data} canEdit={owner} mock={callLimit.mock} actions={{ save: saveCallLimitAction.bind(null, tenantId) }} /> : null}
    </div>
  );
}

/** Practice (the tab's own body): three ways to try the assistant and what "Teach this" does; the panel on the right does the trying. */
export function practiceTab({ t }: { t: Say }) {
  return (
    <section data-part="mya-practice-tab" aria-labelledby="mya-pt-h" className={`${surface} flex flex-col gap-3`}>
      <h2 id="mya-pt-h" className="font-display text-xl font-semibold">
        {t("mya.pt.t")}
      </h2>
      <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-base">
        <li>{t("mya.pt.1")}</li>
        <li>{t("mya.pt.2")}</li>
        <li>{t("mya.pt.3")}</li>
      </ol>
      <p className="m-0 text-sm text-muted">{t("mya.pt.note")}</p>
    </section>
  );
}
