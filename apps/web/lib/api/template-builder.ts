import { jobsScreens } from "@/lib/screens/flag";
import { canSend, type Message } from "@/lib/templates/meta-checks";
import { WIRE_OWN_MESSAGES, wireDraftFor, wireSubmitted } from "@/lib/templates/mock";
import { DRAFT_TEXT_MAX, DRAFT_TEXT_MIN, type DraftAnswer, type DraftInput, type OwnMessage, type SubmitInput } from "@/lib/templates/types";

import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parseDraftAnswer, parseOwnMessage, parseOwnMessages } from "./template-builder-parse";
import { bad, rec } from "./shape";

/**
 * The own WhatsApp messages of a workspace (JOBS; the proposal for C1 is in contracts/template-builder-web-needs.md). SERVER ONLY, with the signed-in person's own token; the parsers are in lib/api/template-builder-parse.ts. With JOBS=mock the made-up
 * answers of lib/templates/mock.ts come back through the same parsers and nothing leaves the server. Writing a draft sends nothing to WhatsApp; only the submit does, and the API asks the second factor for it (403 mfa_required at the first level).
 */
export { parseDraftAnswer, parseOwnMessage, parseOwnMessages };

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}/whatsapp/own-templates`;
};

/**
 * `GET .../own-templates` (C1 contract 1.1 part 1, A5: ONE message with the worst status of its two language templates). null when the screens are off, or when the route answers 404 ("not there yet": the part is then not drawn, quietly). ONLY a 404 is "not there yet":
 * any other refusal (403, 5xx, a shape the web cannot read) is thrown, and the page says "could not be loaded" in that part's place.
 */
export async function readOwnMessages(token: string, tenantId: string): Promise<OwnMessage[] | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return parseOwnMessages(WIRE_OWN_MESSAGES);
  try {
    return parseOwnMessages(await apiRequest(base(tenantId), token));
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

/** The wire form of the message so far (`previous`): both drafts and the group. */
const wireMessage = (m: Message) => ({ category: m.category, drafts: (["te", "en"] as const).map((language) => ({ language, header: m.drafts[language].header, body: m.drafts[language].body, footer: m.drafts[language].footer, buttons: [...m.drafts[language].buttons] })) });

/**
 * `POST .../own-templates/draft {text, languages: ["te","en"], previous?}`: the assistant writes both drafts from a sentence (the customer's name is `{name}`). `unclear` is an answer, not an error. With JOBS=mock a few closed sentences are understood.
 * Nothing is sent to WhatsApp and nothing is stored.
 */
export async function writeOwnMessage(token: string, tenantId: string, input: DraftInput): Promise<DraftAnswer> {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (text.length < DRAFT_TEXT_MIN || text.length > DRAFT_TEXT_MAX) bad("text");
  if (jobsScreens() === "mock") return parseDraftAnswer(wireDraftFor(text));
  const body: Record<string, unknown> = { text, languages: ["te", "en"] };
  if (input.previous) body.previous = wireMessage(input.previous);
  return parseDraftAnswer(await apiRequest(base(tenantId) + "/draft", token, { method: "POST", body: JSON.stringify(body) }));
}

/**
 * `POST .../own-templates {title, category, drafts[]}`: sends the message to WhatsApp for its one check. The API needs the second step (403 `mfa_required` at the first level) and checks the text again (`422 checks_failed`). The web refuses to ask for a message
 * that fails its own checks. The answer is the message as Waiting. With JOBS=mock nothing is sent: the same Waiting answer is made up.
 */
export async function submitOwnMessage(token: string, tenantId: string, input: SubmitInput, nowIso: string = new Date().toISOString(), confirm = false): Promise<OwnMessage> {
  if (!canSend(input.message)) bad("message fails its checks");
  if (input.title.en.trim() === "" || input.title.en.length > 60) bad("title");
  if (jobsScreens() === "mock") return parseOwnMessage(wireSubmitted(`own-mock-${Date.parse(nowIso).toString(36)}`, input.title, input.message.category, nowIso));
  const body = { title: { en: input.title.en, ...(input.title.te ? { te: input.title.te } : {}) }, ...wireMessage(input.message), ...(confirm ? { confirm: true } : {}) };
  const x = rec(await apiRequest(base(tenantId), token, { method: "POST", body: JSON.stringify(body) }), "submitted");
  return parseOwnMessage(x.template ?? x);
}
