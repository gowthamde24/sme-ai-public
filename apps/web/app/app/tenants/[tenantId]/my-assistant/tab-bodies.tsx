import { AboutBusiness } from "@/components/v2/app/assistant/LazyAboutBusiness";
import { AutoReply } from "@/components/v2/app/assistant/LazyAutoReply";
import { CallSettingsAdvanced } from "@/components/v2/app/assistant/LazyCallSettingsAdvanced";
import { TakeOverSwitch } from "@/components/v2/app/assistant/LazyTakeOverSwitch";
import { TalkTraining } from "@/components/v2/app/assistant/LazyTalkTraining";
import { EmptyNext } from "@/components/v2/app/ds/EmptyNext";
import { KnowledgeStep, TalkToYou, VoiceCards, VoiceSegments } from "@/components/v2/app/my-assistant/LazyMyAssistant";
import { Section } from "@/components/v2/app/my-assistant/Section";
import { tabHref } from "@/components/v2/app/my-assistant/tabs";
import { surface } from "@/components/v2/app/ui";
import { wordsFor } from "@/i18n/app-words";
import type { Lang } from "@/i18n/lang";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { offeredLangs } from "@/lib/languages";
import { currentAssistantName } from "@/lib/assistant/name";
import { appV4, moreLanguages, autoReplyScreens, callSettingsScreens, voiceSampleScreens, voicePickerScreens } from "@/lib/screens/flag";

import { setAutoReplyAction } from "../auto-reply-actions";
import { saveCallSettingsAction } from "../call-settings-actions";
import { saveMentionAiAction } from "../opening-line-actions";
import { saveTalkTrainingAction, resetTalkTrainingAction } from "../talk-training-actions";
import { setTakeOverAction } from "../take-over-actions";
import { chooseVoiceAction } from "../voice-picker-actions";
import { loadTalkPrefsAction, previewTalkPrefsAction, saveTalkPrefsAction, undoTalkPrefsAction } from "../talk-prefs-actions";
import { addFactAction, addFileAction, addPasteAction, decideFactAction, discardSourceAction, draftFactsAction, editFactAction } from "../lead-setup-actions";
import { saveSpeaksAction } from "../ai-team/training/speaks-actions";
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

/** Voice & tone: the three sound cards, then the segmented Tone / Words / Region / Addresses over "How your assistant speaks" and Talk training (the greeting lives only there, with Hear it and Edit). */
export function voiceTab({ lang, t, tenantId, base, owner, data, business, ownerFirst = null }: Common & { data: Awaited<ReturnType<typeof readVoiceTab>>; business: string; ownerFirst?: string | null }) {
  const { picker, training, speaks, opening } = data;
  const words = wordsFor(lang, ["tt.", "bv.end.", "sp.", "mya.v.greet.", "mya.v.stop"], ["today.err.mfa.link", "ope.insert", "ope.preview", "ope.err.unknown", "ope.ai.label", "ope.ai.help", "ope.ai.warn", "ope.ai.ok"]);
  const talk = training ? (
    <TalkTraining
      offered={offeredLangs(moreLanguages())}
      assistantName={currentAssistantName()}
      mentionAi={opening ? { value: opening.mentionAi, save: saveMentionAiAction.bind(null, tenantId) } : null}
      words={words}
      initial={training}
      langNames={CALL_LANG_NAMES}
      canEdit={owner}
      securityHref="/app/security"
      business={business}
      actions={{ save: saveTalkTrainingAction.bind(null, tenantId), reset: resetTalkTrainingAction.bind(null, tenantId) }}
      v4={appV4()}
      speaks={speaks ? { ...speaks, save: saveSpeaksAction.bind(null, tenantId) } : null}
      addressToo={speaks !== null}
      hearIt={voiceSampleScreens() !== "off" ? { endpoint: `${base}/voice-sample` } : null}
    />
  ) : null;
  // with "How it talks to you" on, the tab has two named parts: how it talks to customers (everything that was here) and how it talks to the person
  const you = data.talk ? (
    <TalkToYou
      words={wordsFor(lang, ["otp.", "mya.v.warm", "mya.v.calm", "mya.v.bright", "mya.v.selected"])}
      initial={data.talk.prefs.data}
      languages={data.talk.languages}
      first={data.talk.first}
      langNames={CALL_LANG_NAMES}
      mock={data.talk.prefs.mock}
      ownerFirst={ownerFirst}
      actions={{ load: loadTalkPrefsAction.bind(null, tenantId), save: saveTalkPrefsAction.bind(null, tenantId), undo: undoTalkPrefsAction.bind(null, tenantId), preview: previewTalkPrefsAction.bind(null, tenantId) }}
    />
  ) : null;
  return (
    <div className="flex flex-col gap-4" data-part="mya-voice">
      <p className="m-0 text-base text-muted">{t("mya.v.sub")}</p>
      {you ? (
        <h2 data-part="otp-customers-h" className="m-0 mt-2 font-display text-2xl font-bold">
          {t("otp.customers.t")}
        </h2>
      ) : null}
      {!picker && !training ? <EmptyNext title={t("mya.v.empty.t")} text={t("mya.v.empty.d")} action={{ href: `${base}/settings?section=assistant`, label: t("mya.v.empty.go") }} /> : null}
      {picker && voicePickerScreens() !== "off" ? (
        <VoiceCards
          words={wordsFor(lang, ["mya.v.", "vp.mock", "vp.err.sample", "vp.owneronly"])}
          voices={picker.voices}
          choices={picker.choices}
          gender={picker.gender}
          languages={data.languages}
          first={data.languages[0] ?? "te"}
          langNames={CALL_LANG_NAMES}
          canEdit
          endpoint={`${base}/voice-pick`}
          mock={picker.fake}
          choose={chooseVoiceAction.bind(null, tenantId)}
        />
      ) : null}
      {talk && speaks ? <VoiceSegments words={wordsFor(lang, ["mya.v.seg."])}>{talk}</VoiceSegments> : talk}
      {you}
    </div>
  );
}

/** Rules: automatic replies (the auto-send policy), calling hours and put-through-to-you rules (the call settings), and listening in / taking over: the working parts of Settings > AI assistant, reused as they are. */
export function rulesTab({ lang, t, tenantId, base, owner, data }: Common & { data: Awaited<ReturnType<typeof readRulesTab>> }) {
  const { autoReply, takeOver, callSettings } = data;
  const any = autoReply?.mode === "ok" || takeOver?.mode === "ok" || callSettings?.mode === "ok";
  return (
    <div className="flex flex-col gap-4" data-part="mya-rules">
      <p className="m-0 text-base text-muted">{t("mya.r.sub")}</p>
      {!any ? <EmptyNext title={t("mya.r.empty.t")} text={t("mya.r.empty.d")} action={{ href: `${base}/settings?section=assistant`, label: t("mya.r.empty.go") }} /> : null}
      {autoReply?.mode === "ok" && autoReplyScreens() !== "off" ? <AutoReply words={wordsFor(lang, ["ar."], ["today.err.mfa.link"])} initial={autoReply.data} canEdit={owner} change={setAutoReplyAction.bind(null, tenantId)} securityHref="/app/security" /> : null}
      {callSettings?.mode === "ok" && callSettingsScreens() !== "off" ? (
        <CallSettingsAdvanced
          words={wordsFor(lang, ["calls."], ["asst.hours.from", "asst.hours.to", "asst.hours.t", ...["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => `asst.day.${d}`), "today.err.mfa", "today.err.mfa.link"])}
          initial={callSettings.settings}
          locked={callSettings.lockedPurposes}
          canEdit={owner}
          mock={callSettingsScreens() === "mock"}
          saved={callSettings.saved}
          actions={{ save: saveCallSettingsAction.bind(null, tenantId) }}
        />
      ) : null}
      {takeOver?.mode === "ok" ? <TakeOverSwitch words={wordsFor(lang, ["tov."])} initial={takeOver.data} canEdit={owner} change={setTakeOverAction.bind(null, tenantId)} /> : null}
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
