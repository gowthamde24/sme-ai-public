import type { Fabric } from "@/lib/api/catalogue";

import hints from "./fabric-hints.json";

const ORDER = ["cotton_silk", "soft_silk", "kanchi_pattu", "dharmavaram_silk", "banarasi", "mysore_silk", "uppada", "georgette", "pure_cotton"] as const satisfies readonly Fabric[];

/**
 * The fabric a saree's name points to ("TEST Mysore silk" -> Mysore silk), or null. The list is data (fabric-hints.json); the more specific fabrics are asked first ("cotton silk" before "cotton"). The form uses it only until the owner picks a fabric herself: a name typed for ten sarees must not leave every one of them as the first fabric of the list.
 */
export function guessFabric(name: string): Fabric | null {
  const n = name.toLowerCase();
  if (n.trim() === "") return null;
  for (const f of ORDER) {
    const words = (hints as Record<string, readonly string[] | string>)[f];
    if (Array.isArray(words) && words.some((w) => n.includes(w))) return f;
  }
  return null;
}
