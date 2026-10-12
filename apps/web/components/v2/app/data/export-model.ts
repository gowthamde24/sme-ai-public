/** The pure parts of the export form (job CC): the default range and the checks made before a file is asked for. */
const pad = (n: number) => String(n).padStart(2, "0");
export const dayText = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Last month, whole: the first and the last day of the month before `now`'s. */
export function lastMonth(now: Date): { from: string; to: string } {
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: dayText(first), to: dayText(last) };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** null when the range can be asked for; "order" when it starts after it ends (the API itself limits the length to a year and says so). */
export function rangeProblem(from: string, to: string): "order" | "missing" | null {
  if (!DAY.test(from) || !DAY.test(to)) return "missing";
  return from > to ? "order" : null;
}

/** A file name for the download when the API did not suggest one. */
export function fallbackName(format: string, from: string, to: string): string {
  const ext = format === "tally_zip" ? "zip" : format.endsWith("_xml") ? "xml" : format.endsWith("xlsx") ? "xlsx" : "csv";
  return `accounts-${from}-to-${to}.${ext}`;
}
