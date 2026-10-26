import * as wire from "../../../../e2e/visual/packs-wire.mjs";

import { parseFieldDef } from "@/lib/api/field-def";
import { parseWorkspacePack } from "@/lib/api/pack";

import type { WorkspaceField, WorkspacePack } from "./types";

/**
 * TESTS ONLY (job CL). The business types are the files of packages/packs (job CK, the single source of truth): the tests read those very files and put them in the shape the API answers with
 * (`GET /v1/packs`, `GET /v1/tenants/{id}/pack`, `.../modules`: services/ai-api/app/packs/routes.py; e2e/visual/packs-wire.mjs, which the visual stand-in serves too), so a test never holds a second
 * copy of a pack and always sees the real words and modules. A test may name a business type; application code never does.
 */

export const { PACKS_DIR, packFiles, allModules, defaultPackId, selectableIds, packsWire, packWire, modulesWire, fieldsWire } = wire;

/** A workspace pack, parsed the way the web parses the API's answer. */
export function workspacePack(id: string, source: "signup" | "default" | "legacy" | "operator" = "default", enabled?: readonly string[]): WorkspacePack {
  const parsed = parseWorkspacePack(packWire(id, source));
  return enabled ? { ...parsed, modules: [...enabled] } : parsed;
}

export function defaultWorkspacePack(source: "default" | "legacy" = "legacy"): WorkspacePack {
  return workspacePack(defaultPackId(), source);
}

/** The ids of the packs a test can use as "another business type": every selectable pack but the default that carries its words in all four languages (job DR: the nine leads packs ship English words only until a native reader has been through them). */
export function otherPackIds(): string[] {
  const files = packFiles() as Record<string, { labels?: Record<string, unknown> }>;
  return selectableIds().filter((id) => id !== defaultPackId() && ["en", "te", "hi", "kn"].every((lang) => Object.keys(files[id]?.labels?.[lang] ?? {}).length > 0));
}

/** Those fields, parsed the way the web parses the API's answer. */
export function packFields(id: string): WorkspaceField[] {
  return fieldsWire(id).fields.map(parseFieldDef);
}

/** The id of the first selectable pack that has custom fields of this entity (a test that needs fields asks for one by what it has, not by name). */
export function packWithFields(entity: "contact" | "catalogue_item", atLeast = 1): string {
  const order = [defaultPackId(), ...otherPackIds(), ...selectableIds()];   // the reviewed packs first: the tests assert on their words
  const id = order.find((i) => packFields(i).filter((f) => f.entity === entity).length >= atLeast);
  if (!id) throw new Error(`no pack has ${atLeast} ${entity} fields`);
  return id;
}
