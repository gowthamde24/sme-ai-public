/**
 * Shared state of the screen snapshot test (workspace redesign, Batch 0): the API calls a screen makes are answered from
 * `handlers`, set per scenario. A call with no handler fails the test loudly, so a screen can never "pass" on a call that
 * nobody planned. Used only by test/screens/*.
 */
export type Handler = (...args: unknown[]) => unknown;
export const handlers: Record<string, Handler> = {};
export const fixtureErrors: string[] = [];

export function setHandlers(next: Record<string, Handler>): void {
  fixtureErrors.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
  Object.assign(handlers, next);
}

/** Wraps every exported function of a lib/api module whose name is in `names` so it is answered from `handlers`. */
export function wrap<T extends object>(mod: T, names: readonly string[]): T {
  const out: Record<string, unknown> = { ...(mod as Record<string, unknown>) };
  for (const name of names) {
    out[name] = async (...args: unknown[]) => {
      const h = handlers[name];
      if (!h) throw new Error(`screens snapshot: no handler for ${name}(${args.map((a) => JSON.stringify(a)).join(", ").slice(0, 80)})`);
      try {
        return await h(...args);
      } catch (error) {
        // a fixture the real parser refuses is a mistake in this test, not a screen state: never let a page turn it into "could not load"
        if (error instanceof Error && error.constructor.name === "ApiContractError") fixtureErrors.push(`${name}: ${error.message}`);
        throw error;
      }
    };
  }
  return out as T;
}

/** The signed-in person of the scenario being rendered. */
export const session: { user: { id: string; email: string | null; accessToken: string; aal: "aal1" | "aal2"; hasSecondFactor: boolean } } = {
  user: { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.test", accessToken: "tok", aal: "aal2", hasSecondFactor: true },
};
