import type { FieldEntity, FieldKind, WorkspaceField } from "@/lib/packs/types";

import { ApiContractError } from "./client";
import { parseWords } from "./pack";

/** One custom field definition as `GET .../custom-fields` gives it (packages/contracts/packs.ts `CustomFieldDefOut`), validated. In its own file so a test of a screen can stand in for the network calls and still parse the real answer shape. */
type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected ${what} in a custom field response.`);
};

const KINDS: readonly FieldKind[] = ["text", "number", "date", "choice", "multi_choice", "yes_no"];
const ENTITIES: readonly FieldEntity[] = ["contact", "catalogue_item"];
const CODE = /^[a-z][a-z0-9_]{1,39}$/;
const CHOICE_CODE = /^[a-z0-9][a-z0-9_]{0,39}$/;

export function parseFieldDef(json: unknown): WorkspaceField {
  if (!isRecord(json)) return bad("field");
  const { id, entity, code, kind, label, choices, required, position, pii_class: pii, mergeable, active, source } = json;
  if (typeof id !== "string" || id.length < 1 || id.length > 64) return bad("field id");
  if (!ENTITIES.includes(entity as FieldEntity)) return bad("field entity");
  if (typeof code !== "string" || !CODE.test(code)) return bad("field code");
  if (!KINDS.includes(kind as FieldKind)) return bad("field kind");
  if (pii !== "none" && pii !== "personal") return bad("field pii_class");
  if (source !== "pack" && source !== "owner") return bad("field source");
  if (typeof required !== "boolean" || typeof active !== "boolean" || typeof mergeable !== "boolean") return bad("field flags");
  if (typeof position !== "number" || !Number.isSafeInteger(position)) return bad("field position");
  const isChoice = kind === "choice" || kind === "multi_choice";
  let parsed: WorkspaceField["choices"] = null;
  if (isChoice) {
    if (!Array.isArray(choices) || choices.length < 1 || choices.length > 60) return bad("field choices");
    parsed = choices.map((c) => {
      if (!isRecord(c) || typeof c.code !== "string" || !CHOICE_CODE.test(c.code)) return bad("choice code");
      return { code: c.code, label: parseWords(c.label, "choice label") };
    });
  } else if (choices !== undefined && choices !== null) return bad("field choices");
  return { id, entity: entity as FieldEntity, code, kind: kind as FieldKind, label: parseWords(label, "field label"), choices: parsed, required, position, piiClass: pii, mergeable, active, source };
}

