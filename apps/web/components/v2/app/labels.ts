/**
 * The frame's words arrive from the server as `labels` (one language). A component without labels, or a key the server did not send, shows the English
 * source word, so the English frame is the same with or without them. Client-safe: it holds no dictionary.
 */
export type Labels = Readonly<Record<string, string>> | undefined;

export function word(labels: Labels, key: string, english: string, vars?: Record<string, string | number>): string {
  const text = labels?.[key] ?? english;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
}
