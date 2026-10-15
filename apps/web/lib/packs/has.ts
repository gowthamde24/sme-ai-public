import type { WorkspacePack } from "./types";

/**
 * Does this workspace's business type have the module ON? Strict, unlike `moduleOn` (lib/api/pack.ts), which says yes when no pack was read: that is the right answer for a gate that must not lock a workspace out,
 * and the wrong one for "draw the screen of module X instead of the usual one" (jobs CO, CQ, CS), where no pack must mean the usual screen. Code asks for a module, never for a business type.
 */
export function hasModule(pack: Pick<WorkspacePack, "modules"> | null | undefined, module: string): boolean {
  return !!pack && pack.modules.includes(module);
}
