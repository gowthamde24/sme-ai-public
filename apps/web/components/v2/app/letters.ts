/** The two letters of a name ("Ravi Kumar" = RK), else the first two of the e-mail address; "·" when there is nothing. */
export function lettersOf(name: string | null, email: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).map((p) => p.replace(/[^\p{L}]/gu, "")).filter((p) => p !== "");
  const letters = parts.length >= 2 ? `${[...parts[0]][0]}${[...parts[parts.length - 1]][0]}` : parts.length === 1 ? [...parts[0]].slice(0, 2).join("") : (email ?? "").split("@")[0].replace(/[^\p{L}]/gu, "").slice(0, 2);
  return (letters || "·").toUpperCase();
}
