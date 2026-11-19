import { mockSample } from "./mock";
import type { Address, Style, TalkLang } from "./types";

/**
 * The ONE live example line of "How it talks to you" (owner, 19 Nov 2026): the style's sample sentence (the words the preview shows) with the way it calls the person in it. `call` is how the person is called for the chosen address ("Gowtham garu", "Anna / Akka", ...; "" when
 * there is nothing to say, e.g. "By name" with no first name). The friendly sample greets by name ("Hi {first_name}!"): the call takes the name's place; the others get it in front. Pure.
 */
export function exampleFor(language: TalkLang, style: Style, call: string): string {
  const sample = mockSample(language, style);
  if (sample.includes("{first_name}")) return call ? sample.replaceAll("{first_name}", call) : sample.replaceAll(" {first_name}", "").replaceAll("{first_name}", "");
  return call ? `${call}, ${sample}` : sample;
}

/** How the person is called for an address: by name = the first name, garu = the name and the word, sir / madam and anna / akka = the word alone. `word` is the sentence of that address from the words (`vt.me.call.<address>`, with `{name}` in the ones that use it). */
export function callFor(address: Address, first: string | null | undefined, word: (name: string) => string): string {
  const name = (first ?? "").trim().split(/\s+/)[0] ?? "";
  if (address === "by_name") return name;
  if (address === "garu") return name ? word(name) : "";
  return word(name);
}
