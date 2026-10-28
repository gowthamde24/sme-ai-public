/** The two letters of a name ("Ravi Kumar" = RK, "Ravi" = RA), else the first two of the e-mail address; "·" when there is nothing. */
export function lettersOf(name: string | null, email: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const from = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words.length === 1 ? words[0].slice(0, 2) : (email ?? "").split("@")[0].slice(0, 2);
  return (from || "·").toUpperCase();
}
