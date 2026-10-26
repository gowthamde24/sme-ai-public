import { LIST_MAX, type ListedPerson } from "./types";

/**
 * The list an owner pastes under an instruction ("or give a list"): one person per line, a name and a phone number in either order, or just the number. Pure and forgiving about separators (comma, tab, semicolon, bar); a line with no
 * usable number is counted as `skipped`, never guessed. At most LIST_MAX people. The API matches the numbers to the workspace's OWN contacts: a number that is not one of them is never contacted.
 */
export type ParsedList = { people: ListedPerson[]; skipped: number; tooMany: boolean };

const digits = (s: string) => s.replace(/\D/g, "");
const looksLikePhone = (s: string) => /^\+?[0-9(][0-9 ()-]*[0-9]$/.test(s.trim()) && digits(s).length >= 7 && digits(s).length <= 15;

export function parseList(text: string): ParsedList {
  const people: ListedPerson[] = [];
  let skipped = 0;
  let tooMany = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[,;\t|]+/).map((p) => p.trim()).filter(Boolean);
    const phone = parts.find(looksLikePhone) ?? (looksLikePhone(line) ? line : undefined);
    if (!phone) {
      skipped++;
      continue;
    }
    if (people.length >= LIST_MAX) {
      tooMany = true;
      continue;
    }
    const name = parts.filter((p) => p !== phone).join(" ").trim().slice(0, 80);
    people.push(name ? { name, phone: phone.trim() } : { phone: phone.trim() });
  }
  return { people, skipped, tooMany };
}
