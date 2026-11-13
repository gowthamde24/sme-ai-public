import { type ReactNode } from "react";

import { FinishChip } from "@/components/v2/app/today/v6/day-one/FinishChip";
import { doneCount, showChecklist, showChip, stepViews, type StepId } from "@/components/v2/app/today/v6/day-one/steps";
import { maskNumber } from "@/components/v2/app/today/v6/band-data";
import type { CallLine } from "@/components/v2/app/today/v6/StatusCard";
import type { DayOneIn, V6In } from "@/components/v2/app/today/v6/types";
import { wordsFor } from "@/i18n/app-words";
import { LANGUAGE_NAMES, type Lang } from "@/i18n/lang";
import { ApiAuthError } from "@/lib/api/client";
import { getCall, listCalls } from "@/lib/api/calls";
import { MOCK_CALL } from "@/lib/calls/mock";
import { hasOwnName, missingFor, readMockPhone } from "@/lib/assistant-status/go-live";
import { readAssistantStatus } from "@/lib/assistant-status/source";
import { readChoice } from "@/lib/assistant-status/setup-choice";
import type { StepCheck } from "@/lib/packs/activation";
import { readFacts } from "@/lib/packs/activation-facts";
import { assistantStatusScreens, callScreens, designV6 } from "@/lib/screens/flag";

import { dismissChipAction, goLiveAction, skipSetupAction, testNumberAction } from "./day-one-actions";

/** The pretend call's words, in the status card's two voices. */
const mockLines = (): CallLine[] => MOCK_CALL.transcript.map((l) => ({ who: l.who === "ai" ? "assistant" : "customer", text: l.text }));

/** The last finished conversation's last two lines (the status card's LAST CONVERSATION). A read that fails, or takes longer than 1.5 s, is no conversation (Today never waits for it). */
async function readLast(token: string, tenantId: string): Promise<{ who: string; lines: CallLine[] } | null> {
  const run = async () => {
    const page = await listCalls(token, tenantId);
    const row = page.items.find((c) => !c.live && c.state === "completed" && !c.sandbox);
    if (!row) return null;
    const d = await getCall(token, tenantId, row.id);
    const lines = (d.transcript ?? []).slice(-2).map((l): CallLine => ({ who: l.who === "assistant" ? "assistant" : "customer", text: l.textEn ?? l.text }));
    return lines.length > 0 ? { who: row.who, lines } : null;
  };
  try {
    return await Promise.race([run(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))]);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/** The seven steps of day one, done or not, from what can be read. A fact that cannot be read is "not done". "Practise" has no fact yet (C1's onboarding progress is still to build). */
async function readDone(token: string, tenantId: string, shop: string, modules: readonly string[], status: NonNullable<Awaited<ReturnType<typeof readAssistantStatus>>>, missing: readonly string[]): Promise<Partial<Record<StepId, boolean>>> {
  const facts: Partial<Record<StepCheck, boolean>> = await readFacts(token, tenantId, ["catalogue_has_items", "lead_source_added"], modules).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : {}));
  return {
    shop: hasOwnName(shop),
    catalogue: facts.catalogue_has_items === true,
    speaks: !status.usingDefaults.includes("voice"),
    rules: !status.usingDefaults.includes("rules"),
    practise: false,
    phone: !missing.includes("phone_number"),
    sources: facts.lead_source_added === true,
  };
}

/**
 * Everything the page gives Today for the design system v6 (null where DESIGN_V6 is off): the words, the status card's masked number and last conversation, and the day one checklist (until the assistant is live, unless skipped) or the "Finish setup" chip.
 * `mode`: the calls flag `mock` shows the pretend last conversation, and `?live=1` the pretend live call (staging); with the real API the last conversation is read from the calls, and a live call comes from the live-call poll in the browser.
 */
export async function readV6({ token, tenantId, role, lang, shop, userName, modules, setup, live, base }: { token: string; tenantId: string; role: "owner" | "admin" | "sales" | "viewer"; lang: Lang; shop: string; userName: string | null; modules: readonly string[]; /** `?setup=1`: the chip's link reopens the checklist. */ setup: string | null; /** `?live=1`: the pretend live call (CALL_SCREENS=mock only). */ live: string | null; base: string }): Promise<V6In | null> {
  if (!designV6()) return null;
  const manages = role === "owner" || role === "admin";
  const words = wordsFor(lang, ["tv6.", "dst."]);
  const callMode = callScreens();
  const lastAsked = callMode === "on" && (manages || role === "sales") ? readLast(token, tenantId) : Promise.resolve(null);
  lastAsked.catch(() => undefined);
  const [status, choice, phone] = await Promise.all([readAssistantStatus(token, tenantId), readChoice(tenantId), readMockPhone()]);
  const missing = (await missingFor(status, shop)) ?? [];
  // an assistant whose status cannot be known is taken as live: no checklist is drawn on a guess
  const isLive = status === null || status.state === "live";
  const checklist = showChecklist({ live: isLive, choice, reopen: setup === "1", manages });
  const wantDone = status !== null && manages && (checklist || choice !== "dismissed");
  const done = wantDone && status ? await readDone(token, tenantId, shop, modules, status, missing) : null;
  const steps = done ? stepViews(done, base) : null;
  const count = steps ? doneCount(steps) : 0;
  const dayOne: DayOneIn | null =
    checklist && steps
      ? {
          name: userName ?? shop,
          steps,
          canGoLive: missing.length === 0,
          missing: missing.filter((m): m is "business_name" | "phone_number" => m === "business_name" || m === "phone_number"),
          actions: { skip: skipSetupAction.bind(null, tenantId), goLive: goLiveAction.bind(null, tenantId), testNumber: manages && assistantStatusScreens() === "mock" ? testNumberAction.bind(null, tenantId) : null },
          helpHref: "/app/support/whatsapp?page=today",
          testCallHref: `${base}/calls`,
        }
      : null;
  const chip: ReactNode = steps && showChip({ done: count, choice, checklistShown: checklist, manages }) ? <FinishChip done={count} base={base} words={words} dismiss={dismissChipAction.bind(null, tenantId)} /> : null;
  const mockOn = callMode === "mock";
  return {
    words,
    language: LANGUAGE_NAMES[lang].native,
    number: maskNumber(phone),
    last: mockOn ? { who: MOCK_CALL.callee, lines: mockLines().slice(-2) } : await lastAsked,
    mock: mockOn && live === "1" ? { caller: MOCK_CALL.callee, lines: mockLines() } : null,
    mockMore: 1,
    dayOne,
    chip,
  };
}
