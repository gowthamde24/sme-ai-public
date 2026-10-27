import type { TypeGroup } from "@/components/v2/auth/TypeCombobox";

import type { SignupCard } from "./signup";

/** The business type of "Other": a business that is none of the listed ones and starts from the general Lead Desk set-up, with what it is written in the Owner's own words. The API lists it among the types once it has it; until then there is no "Other" row. */
export const OTHER_TYPE = "other";

/**
 * The business types as ONE grouped list: "Built especially for" (the types with their own pages, tools and words), "Lead Desk" (the types with a lead template: `templateIds`, the API's own list) and "Other" (if the API lists it). An empty
 * group is not drawn; with no template list the types are one group. No business type is named here: the groups come from what the API lists.
 */
export function typeGroups(cards: readonly SignupCard[], templateIds: ReadonlySet<string>, words: { deep: string; leads: string; all: string; other: string; otherTagline: string }): TypeGroup[] {
  const other = cards.find((c) => c.id === OTHER_TYPE);
  const rest = cards.filter((c) => c.id !== OTHER_TYPE);
  const option = (c: SignupCard) => ({ id: c.id, name: c.name, tagline: c.tagline });
  const lead = rest.filter((c) => templateIds.has(c.id));
  const deep = rest.filter((c) => !templateIds.has(c.id));
  const groups: TypeGroup[] = templateIds.size === 0 ? [{ key: "all", label: words.all, options: rest.map(option) }] : [{ key: "deep", label: words.deep, options: deep.map(option) }, { key: "leads", label: words.leads, options: lead.map(option) }];
  if (other) groups.push({ key: "other", label: words.other, options: [{ id: OTHER_TYPE, name: words.other, tagline: words.otherTagline }] });
  return groups.filter((g) => g.options.length > 0);
}
