export const PACKS_DIR: string;
export function packFiles(): Record<string, Record<string, unknown> & { id: string; status: string; modules: string[]; labels: Record<string, Record<string, string>>; custom_fields: Record<string, unknown>[] }>;
export function allModules(): string[];
export function defaultPackId(): string;
export function selectableIds(): string[];
export function packsWire(): { packs: Record<string, unknown>[] };
export function packWire(id: string, source?: "signup" | "default" | "legacy" | "operator"): Record<string, unknown>;
export function modulesWire(enabled: readonly string[]): { modules: { module: string; enabled: boolean; reason: string }[] };
export function fieldsWire(id: string): { fields: Record<string, unknown>[] };
