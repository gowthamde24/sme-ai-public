import type { WorkTransport } from "./client";

/**
 * A work transport whose code (the parsers of the answers, `./client`, `./types`) loads with its first call: the composer on Today holds one from the moment it is drawn, but a person who never attaches a file or presses a card does not carry that code in the first load of the page
 * (perf fix b, 19 Nov 2026). Same shape as `fixtureTransport`'s own lazy wrapper; the first call waits for the chunk, which the chat's thread (it loads with the first use of the composer) already brings.
 */
export function lazyTransport(make: () => Promise<WorkTransport>): WorkTransport {
  let real: Promise<WorkTransport> | null = null;
  const get = () => (real ??= make());
  return {
    upload: async (file, onProgress, signal) => (await get()).upload(file, onProgress, signal),
    decide: async (planId, decision, confirmed) => (await get()).decide(planId, decision, confirmed),
    undo: async (planId) => (await get()).undo(planId),
    saveSecret: async (requestId, value) => (await get()).saveSecret(requestId, value),
    liveTest: async (setupId, test) => (await get()).liveTest(setupId, test),
    undoAction: async (actionId) => (await get()).undoAction(actionId),
    undoTalkPrefs: async (token) => (await get()).undoTalkPrefs(token),
    importGet: async (importId, cursor) => (await get()).importGet(importId, cursor),
    importEdit: async (importId, change) => (await get()).importEdit(importId, change),
    importConfirm: async (importId, consentSource, excludeRowIds) => (await get()).importConfirm(importId, consentSource, excludeRowIds),
    importCancel: async (importId) => (await get()).importCancel(importId),
    importDestination: async (importId, destination) => (await get()).importDestination(importId, destination),
    messageUndo: async (messageId) => (await get()).messageUndo(messageId),
    messageStatus: async (messageId) => (await get()).messageStatus(messageId),
  };
}

/** This workspace's own route (`routeTransport(base)`), its code loaded at the first call. */
export const lazyRouteTransport = (base: string): WorkTransport => lazyTransport(() => import("./client").then((m) => m.routeTransport(base)));
/** The made-up answers (`fixtureTransport()`), their code loaded at the first call. */
export const lazyFixtureTransport = (): WorkTransport => lazyTransport(() => import("./client").then((m) => m.fixtureTransport()));
