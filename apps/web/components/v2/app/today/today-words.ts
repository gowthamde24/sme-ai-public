/**
 * The words the client parts of Today need (the cards, the Agent OWL card, the usage card, "Done while you slept"). Like the Ask box's words they live in a file of their own and are resolved by
 * the server in the person's language and handed down as props: a client component must not import the dictionaries (all four would land in the browser bundle). A placeholder such as {n} is
 * left in the text and filled here, by `say`.
 */
// The list of keys and `todayWords` are in ./today-word-keys.ts (server side, and the demo video): a client part imports only `say` from here, so the browser never carries the whole key list (route-JS budget).
export type TodayWords = Readonly<Record<string, string>>;

/** One word of a client part, with its {placeholders} filled. A key the server did not send shows as itself, so a missing word is noticed. */
export function say(words: TodayWords, key: string, vars?: Record<string, string | number>): string {
  const text = words[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
}
