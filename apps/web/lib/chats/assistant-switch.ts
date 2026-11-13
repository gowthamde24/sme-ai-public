import { isCanonicalUuid } from "@/lib/api/crm";
import { readJar, writeJar } from "@/lib/mock/jar";
import { chatAssistantSwitch } from "@/lib/screens/flag";

/**
 * The per-chat "Assistant: on/off" switch (owner, 13 Nov 2026; flag CHAT_ASSISTANT_SWITCH). C1 adds `assistant_enabled` to the conversations but has no way to save it yet, so the owner's choice is kept in ONE small cookie of the browser: the chats the assistant is OFF for
 * (the latest 20; a chat is back "on" when it is taken out of the list). Nothing is sent anywhere. SERVER ONLY.
 */
export const COOKIE = "sme_chat_assistant_off";
export const MAX_OFF = 20;
const parse = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && isCanonicalUuid(x)).slice(-MAX_OFF) : null);

export const switchOn = (): boolean => chatAssistantSwitch() !== "off";

export async function readOffList(): Promise<string[]> {
  return switchOn() ? readJar(COOKIE, parse, []) : [];
}

/** Turn the assistant on or off for one chat. false = refused (the switch is not there, or a bad id). */
export async function setAssistant(leadId: string, on: boolean): Promise<boolean> {
  if (!switchOn() || !isCanonicalUuid(leadId)) return false;
  const off = (await readJar(COOKIE, parse, [])).filter((x) => x !== leadId);
  return writeJar(COOKIE, on ? off : [...off, leadId].slice(-MAX_OFF));
}
