import { makeT, type Say } from "@/components/v2/app/words";
import { getLang } from "@/i18n/get-lang";
import { wordsFor } from "@/i18n/app-words";

/** For a server action (job BK): the sentences of the person's language for the screens it serves, e.g. `const t = await serverT(["orders."])`. Outside a request (a unit test) the language is English. */
export async function serverT(prefixes: readonly string[]): Promise<Say> {
  return makeT(wordsFor(await getLang(), prefixes));
}
