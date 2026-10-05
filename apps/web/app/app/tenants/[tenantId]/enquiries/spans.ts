/**
 * Where the quotes of the fields sit in the enquiry text. The offsets the API gives are CODE POINT offsets into the stored text (the
 * database and the runtime count Unicode code points, not UTF-16 units), so the text is split with Array.from. Everything returned is
 * plain strings: the page renders them as text nodes, never as markup.
 */
export type QuoteSpan = { start: number; end: number; id: string };
export type Segment = { text: string; ids: string[] };

export function segments(body: string, spans: QuoteSpan[]): Segment[] {
  const chars = Array.from(body);
  const valid = spans.filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start);
  const cuts = new Set<number>([0, chars.length]);
  for (const s of valid) {
    cuts.add(Math.min(s.start, chars.length));
    cuts.add(Math.min(s.end, chars.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (to <= from) continue;
    const ids = valid.filter((s) => s.start <= from && s.end >= to).map((s) => s.id);
    out.push({ text: chars.slice(from, to).join(""), ids });
  }
  return out;
}
