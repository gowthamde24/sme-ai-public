// The business types AS THE API ANSWERS FOR THEM (job CL, on top of job CK): read from the very files in packages/packs and put in the shape of services/ai-api/app/packs/routes.py and
// app/customfields/routes.py (packages/contracts/packs.ts). One place: the visual stand-in (fixtures.mjs) serves these, and the unit tests (apps/web/lib/packs/pack-test-kit.ts) use them, so nothing
// holds a second copy of a pack. Synthetic and read-only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "packs");

/** Every pack.json, by folder name. */
export function packFiles() {
  const out = {};
  for (const e of fs.readdirSync(PACKS_DIR, { withFileTypes: true })) {
    const file = path.join(PACKS_DIR, e.name, "pack.json");
    if (e.isDirectory() && fs.existsSync(file)) out[e.name] = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return out;
}

/** The 25 modules of the closed list (modules.json). */
export function allModules() {
  return JSON.parse(fs.readFileSync(path.join(PACKS_DIR, "modules.json"), "utf8")).modules.map((m) => m.code);
}

/** The pack every existing workspace runs (`default_for_existing_workspaces`). */
export function defaultPackId() {
  const found = Object.values(packFiles()).find((p) => p.default_for_existing_workspaces === true);
  if (!found) throw new Error("no default pack in packages/packs");
  return found.id;
}

/** The ids a new person may choose (preview or published), in the API's order (services/ai-api/app/packs/registry.py): reviewed ones first, then by id. */
export function selectableIds() {
  return Object.values(packFiles())
    .filter((p) => p.status !== "draft")
    .sort((a, b) => Number(a.status !== "published") - Number(b.status !== "published") || (a.id < b.id ? -1 : 1))
    .map((p) => p.id);
}

const summary = (m) => ({ pack_id: m.id, version: m.version, status: m.status, validated: m.status === "published", names: m.names, summary: m.summary, accent: m.accent, owl_prop: m.owl_prop });

/** GET /v1/packs */
export function packsWire() {
  const files = packFiles();
  return { packs: selectableIds().map((id) => summary(files[id])) };
}

/** GET /v1/tenants/{id}/pack */
export function packWire(id, source = "default") {
  const m = packFiles()[id];
  if (!m) throw new Error(`no pack ${id}`);
  return { ...summary(m), source, chosen_at: "2026-10-01T00:00:00Z", core_tab: m.core_tab, modules: m.modules, units: m.units, default_unit: m.default_unit ?? null, labels: m.labels, language_review: m.language_review, has_example_data: Object.values(m.example_data ?? {}).some((rows) => Array.isArray(rows) && rows.length > 0) };
}

/** GET /v1/tenants/{id}/modules: all 25, the given ones ON. */
export function modulesWire(enabled) {
  return { modules: allModules().map((module) => ({ module, enabled: enabled.includes(module), reason: "pack" })) };
}

/** GET /v1/tenants/{id}/custom-fields: the pack's own fields (source "pack"). */
export function fieldsWire(id) {
  const m = packFiles()[id];
  return { fields: (m.custom_fields ?? []).map((f, i) => ({ id: `${id}-${f.code}`, entity: f.entity, code: f.code, label: f.label, kind: f.kind, choices: f.choices ?? null, required: f.required, position: i + 1, pii_class: f.pii_class, mergeable: f.mergeable, active: true, source: "pack" })) };
}
