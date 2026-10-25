import { withAssistantName } from "@/lib/assistant/name";

/**
 * The frame's words arrive from the server as `labels` (one language). A component without labels, or a key the server did not send, shows the English
 * source word, so the English frame is the same with or without them. Client-safe: it holds no dictionary.
 */
export type Labels = Readonly<Record<string, string>> | undefined;

export function word(labels: Labels, key: string, english: string, vars?: Record<string, string | number>): string {
  const text = withAssistantName(labels?.[key] ?? english);
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
}

/** The frame's words with the business type's own words on top (job CL: "Orders & deliveries", "Parents & students"). With no pack, or no change, the same object comes back. */
export function withPackWords(labels: Labels, pack: { labels: Readonly<Record<string, string>> } | null | undefined): Labels {
  if (!pack || Object.keys(pack.labels).length === 0) return labels;
  return { ...labels, ...pack.labels };
}
