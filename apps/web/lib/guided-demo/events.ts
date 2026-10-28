import { randomUUID } from "node:crypto";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { previewOpeningLine } from "@/lib/api/opening-line";
import { getAiAssistant, postTestCall } from "@/lib/api/ai-assistant";
import { sendAssistantMessage } from "@/lib/api/assistant";
import { createContact, createCustomerCompany, createLead } from "@/lib/api/customers";
import { createCallRequest } from "@/lib/api/outbox";
import { bookVisit, getSlots } from "@/lib/api/visits";

import { clip, demoLead, type Line, type StepKey, type StepResult } from "./script";

/**
 * What each step of the guided demo DOES, through the real API with the signed-in person's own token (SERVER ONLY; the caller has checked that the workspace is a DEMO one and that the person is its Owner or an Admin):
 * a made-up lead of the reserved demo number range, the assistant's simulated test call with the preview sound of the workspace's own voice, one real question to the assistant (an answer from the catalogue, with
 * its sources), a follow-up CALL REQUEST (nothing dials until the Owner approves) and a visit in the first free slot. A business type whose workspace may not keep leads of this kind (the API says 403) skips the steps that need one. Every step answers `{ ok: false }` on any failure: nothing is half-told.
 */
export type Ctx = { token: string; tenantId: string };
export type Input = { run: string; leadId: string | null; question: string };

const NO_LINES: Line[] = [];
const ok = (over: Partial<Extract<StepResult, { ok: true }>> = {}): StepResult => ({ ok: true, lines: NO_LINES, sound: null, leadId: null, note: null, ...over });

/** India's calendar date n days from now (the shop's day), as YYYY-MM-DD. */
const istDay = (plusDays = 0): string => new Date(Date.now() + 5.5 * 3_600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

async function lead(ctx: Ctx, input: Input): Promise<StepResult> {
  const who = demoLead(input.run);
  const companyId = randomUUID();
  const contactId = randomUUID();
  const leadId = randomUUID();
  try {
    await createCustomerCompany(ctx.token, ctx.tenantId, { id: companyId, name: who.name });
    await createContact(ctx.token, ctx.tenantId, { id: contactId, companyId, fullName: who.name, phone: who.phone, email: null });
    await createLead(ctx.token, ctx.tenantId, { id: leadId, companyId, contactId, source: "whatsapp" });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) return ok({ note: "skip" }); // this business type does not keep leads of this kind
    throw error;
  }
  return ok({ leadId });
}

async function reach(ctx: Ctx): Promise<StepResult> {
  const call = await postTestCall(ctx.token, ctx.tenantId);
  const lines: Line[] = call.transcript.map((l) => ({ who: l.speaker === "assistant" ? "assistant" : "lead", text: clip(l.text) }));
  let sound = null;
  try {
    const lang = (await getAiAssistant(ctx.token, ctx.tenantId)).settings.lang;
    sound = (await previewOpeningLine(ctx.token, ctx.tenantId, lang)).audio;
  } catch {
    /* the words are told without the sound */
  }
  return ok({ lines, sound });
}

async function ask(ctx: Ctx, input: Input): Promise<StepResult> {
  const lines: Line[] = [{ who: "lead", text: clip(input.question) }];
  let answer = "";
  try {
    for await (const event of sendAssistantMessage(ctx.token, ctx.tenantId, { messageId: randomUUID(), text: input.question })) {
      if (event.type === "text") answer += event.delta;
      if (event.type === "error") return ok({ lines, note: "none" });
    }
  } catch {
    return ok({ lines, note: "none" });
  }
  answer = answer.trim();
  return answer === "" ? ok({ lines, note: "none" }) : ok({ lines: [...lines, { who: "assistant", text: clip(answer, 700) }] });
}

async function followup(ctx: Ctx, input: Input): Promise<StepResult> {
  if (input.leadId === null) return ok({ note: "skip" });
  await createCallRequest(ctx.token, ctx.tenantId, { requestId: randomUUID(), leadId: input.leadId, reason: "Follow up on the question about the price and a visit.", scriptDraft: "Hello, this is a follow-up on your question about the price. Shall we fix a time for you to come and see it?", language: "en" });
  return ok();
}

async function visit(ctx: Ctx, input: Input): Promise<StepResult> {
  if (input.leadId === null) return ok({ note: "skip" });
  for (const plus of [0, 1, 2, 3]) {
    const date = istDay(plus);
    const slots = await getSlots(ctx.token, ctx.tenantId, date);
    const slot = slots.open ? slots.slots.find((s) => s.free > 0 && !s.past) : undefined;
    if (!slot) continue;
    await bookVisit(ctx.token, ctx.tenantId, { visitId: randomUUID(), leadId: input.leadId, date, slot: slot.start, partySize: 1, purpose: "Demo visit" });
    return ok();
  }
  return { ok: false };
}

export async function runDemoStep(ctx: Ctx, key: StepKey, input: Input): Promise<StepResult> {
  try {
    if (key === "lead") return await lead(ctx, input);
    if (key === "reach") return await reach(ctx);
    if (key === "ask") return await ask(ctx, input);
    if (key === "followup") return await followup(ctx, input);
    if (key === "visit") return await visit(ctx, input);
    return ok();
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { ok: false };
  }
}
