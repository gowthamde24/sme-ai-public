/** Turning what an owner types into the codes a custom field keeps (job CL). Pure. */

/** `Dispatch time` -> `dispatch_time`: the code a field keeps for good (a-z, 0-9, _; starts with a letter; at most 32). */
export function codeOf(label: string): string {
  const base = label
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return /^[a-z]/.test(base) && base.length >= 2 ? base : `field_${Math.abs([...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36).slice(0, 6)}`;
}

/** Up to 20 choices, one per line, each at most 60 characters; the code is made from the words and kept unique. */
export function parseChoices(text: string): { code: string; label: string }[] | null {
  const lines = [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
  if (lines.length < 2 || lines.length > 20 || lines.some((l) => l.length > 60)) return null;
  const seen = new Set<string>();
  return lines.map((l) => {
    let code = codeOf(l).slice(0, 28);
    while (seen.has(code)) code = `${code.slice(0, 25)}_${seen.size}`;
    seen.add(code);
    return { code, label: l };
  });
}
