/**
 * Customers > Map (app v4 part 5, owner 7 Nov 2026): where the customers ARE, as a list of real places. Nothing is looked up or guessed (no geocoding, nothing paid): a customer is in a place only when their enquiry or profile gave
 * a city (and an area), and a site only when its own address says so. Pure, so it is tested without a server. Places are grouped by city (spelling and capital letters do not split one), the biggest first.
 */
export type PlaceEntry = { kind: "customer" | "site"; id: string; name: string; /** "Brodipet, Guntur" or "12 Lake Road, Guntur 522001" */ line: string; href: string | null };
export type Place = { key: string; city: string; entries: PlaceEntry[] };
export type MapLead = { id: string; name: string; profile?: { city: string | null; area: string | null } | null };
export type MapSite = { id: string; name: string; address_line: string | null; city: string | null; pin: string | null };

const cityKey = (c: string): string => c.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const clean = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t.slice(0, max);
};

export function groupPlaces(leads: readonly MapLead[], sites: readonly MapSite[], base: string): { places: Place[]; customers: number; withoutPlace: number; sites: number } {
  const byCity = new Map<string, Place>();
  const put = (city: string, entry: PlaceEntry) => {
    const key = cityKey(city);
    const place = byCity.get(key) ?? { key, city, entries: [] };
    place.entries.push(entry);
    byCity.set(key, place);
  };
  let withoutPlace = 0;
  let placed = 0;
  for (const l of leads) {
    const city = clean(l.profile?.city, 80);
    if (!city) {
      withoutPlace += 1;
      continue;
    }
    const area = clean(l.profile?.area, 80);
    put(city, { kind: "customer", id: l.id, name: clean(l.name, 120) ?? "", line: [area, city].filter(Boolean).join(", "), href: `${base}/customers/${l.id}` });
    placed += 1;
  }
  let siteCount = 0;
  for (const s of sites) {
    const city = clean(s.city, 80);
    const address = clean(s.address_line, 200);
    if (!city && !address) continue; // a site with no address says nothing about where
    const line = [address, [city, clean(s.pin, 12)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    put(city ?? address ?? "", { kind: "site", id: s.id, name: clean(s.name, 120) ?? "", line, href: null });
    siteCount += 1;
  }
  const places = [...byCity.values()]
    .map((p) => ({ ...p, entries: p.entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.entries.length - a.entries.length || a.city.localeCompare(b.city));
  return { places, customers: placed, withoutPlace, sites: siteCount };
}
