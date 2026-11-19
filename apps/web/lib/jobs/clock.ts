/** "9 am", "9:30 pm": a time of day in minutes since midnight the way the shop says it (its own tiny module so a card that only needs the clock does not load the whole job page's logic). */
export function fmtMinutes(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m === 0 ? "" : `:${String(m).padStart(2, "0")}`} ${h < 12 ? "am" : "pm"}`;
}
