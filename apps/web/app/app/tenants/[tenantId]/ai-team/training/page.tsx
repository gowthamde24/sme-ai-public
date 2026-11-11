import { notFound, redirect } from "next/navigation";

import { TalkTraining } from "@/components/v2/app/assistant/LazyTalkTraining";
import { VoicePicker } from "@/components/v2/app/assistant/LazyVoicePicker";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain, surface } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { ApiAuthError, ApiRequestError, fetchTenant, publicApiBase } from "@/lib/api/client";
import { voiceSocketUrl } from "@/lib/browser-voice/protocol";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getTalkTraining } from "@/lib/api/talk-training";
import { requireUser } from "@/lib/auth/session";
import { appV4, talkTrainingScreens, voicePickerScreens } from "@/lib/screens/flag";
import { readSpeaks } from "@/lib/talk-training/speaks-source";
import { readFacts } from "./speaks-facts";
import { saveSpeaksAction } from "./speaks-actions";
import { readVoicePicker } from "@/lib/voice-picker/source";
import { LIVE_LANGS } from "@/lib/voice-picker/types";

import { menuTitle } from "../../menu-title";
import { practiceCallAction, resetTalkTrainingAction, saveTalkTrainingAction } from "../../talk-training-actions";
import { chooseVoiceAction, chooseVoiceGenderAction } from "../../voice-picker-actions";

export const metadata = { title: `Train how it talks · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/ai-team/training (AI team > Train how it talks; the Owner's): "How I talk to customers" on a page of its own (owner rule, 6 Nov: every menu item opens its own page; the panel left Settings > AI assistant, which
 * links here). C1's talk-training (docs/contracts/talk-training.md): the greeting, how to address people, the questions, the words never to say, answers to objections, good examples and the platform's rules read-only. A part the API cannot
 * read says so in plain words, never "Not available yet".
 */
export default async function TrainingPage({ params }: PageProps<"/app/tenants/[tenantId]/ai-team/training">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const t = appT(lang);
  const title = await menuTitle("train", lang, user.accessToken, tenantId);
  if (tenant.role !== "owner") return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={title} message={t("tt.owneronly")} />;
  // practice by voice (app v4, C1 #402): the Live talk socket of this workspace
  const voiceUrl = appV4() ? voiceSocketUrl(publicApiBase(), tenantId) : null;
  const training = talkTrainingScreens() ? await getTalkTraining(user.accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  // "How your assistant speaks" (owner 11 Nov; C1's contract): one panel in place of "How to address customers"; made-up in the test mode (SPEAKS_PANEL_SCREENS=mock), C1's endpoint with `1`; null = not there
  const speaksRead = training ? await readSpeaks({ token: user.accessToken, tenantId }, await readFacts(user.accessToken, tenantId, user.id).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : { legacyAddress: null, packDefault: "friendly" as const, ownerName: null }))) : null;
  const speaks = speaksRead?.mode === "ok" ? { initial: speaksRead.data, demo: speaksRead.demo, save: saveSpeaksAction.bind(null, tenantId) } : null;
  // "Your caller" (app v4, owner 9 Nov 2026): the phone voice is chosen at the TOP of this page, then how it talks, never say / say it like this, and practice
  const picker = appV4() && voicePickerScreens() !== "off" ? await readVoicePicker({ token: user.accessToken, tenantId }).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={title} sub={t("tt.sub")} />
      <div className="mt-6 flex max-w-3xl flex-col gap-5">
        {picker?.mode === "ok" ? (
          <VoicePicker
            id="your-caller"
            title={t("tt.caller")}
            sub={t("tt.caller.sub")}
            gender={picker.data.gender}
            words={wordsFor(lang, ["vp."])}
            rows={LIVE_LANGS.map((l) => ({ language: l, voices: picker.data.voices.filter((v) => v.language === l), choice: picker.data.choices[l] ?? null }))}
            langNames={CALL_LANG_NAMES}
            canEdit
            endpoint={`/app/tenants/${tenantId}/voice-pick`}
            mock={voicePickerScreens() === "mock"}
            actions={{ choose: chooseVoiceAction.bind(null, tenantId), setGender: chooseVoiceGenderAction.bind(null, tenantId) }}
          />
        ) : null}
        {training ? (
          <TalkTraining
            words={wordsFor(lang, ["tt.", "bv.end.", "sp."], ["today.err.mfa.link"])}
            initial={training}
            langNames={CALL_LANG_NAMES}
            canEdit
            securityHref="/app/security"
            business={tenant.name}
            actions={{ save: saveTalkTrainingAction.bind(null, tenantId), reset: resetTalkTrainingAction.bind(null, tenantId) }}
            v4={appV4()}
            speaks={speaks}
            practice={appV4() ? practiceCallAction.bind(null, tenantId) : null}
            voice={voiceUrl ? { url: voiceUrl, tokenUrl: `/app/tenants/${tenantId}/ai-team/training/practice-token` } : null}
          />
        ) : (
          <section className={surface} data-part="tt-unread">
            <p className="text-base text-muted">{t("tt.unread")}</p>
          </section>
        )}
      </div>
    </main>
  );
}
