/** The two letters of a name ("Ravi Kumar" = RK, "Ravi" = RA), else the first two letters of the e-mail address; "·" when there is nothing. Only letters count ("Asha (synthetic)" = AS). Drawn on the server. */
export function lettersOf(name: string | null, email: string | null): string {
  const words = (name ?? "").split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, "")).filter(Boolean);
  const from = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words.length === 1 ? words[0].slice(0, 2) : (email ?? "").split("@")[0].replace(/[^\p{L}]/gu, "").slice(0, 2);
  return (from || "·").toUpperCase();
}
