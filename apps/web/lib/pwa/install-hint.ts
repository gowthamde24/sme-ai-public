/**
 * The "Add to home screen" hint (job BL): when to offer it, as pure functions the component and the tests share. The hint is gentle: only on a phone, only for someone who keeps coming back (the
 * third visit), never in the installed app, and a "Not now" keeps it away for 30 days. The count and the choice live on this device only (browser storage, key "sme-install-hint"); nothing is sent.
 */
export const HINT_KEY = "sme-install-hint";
export const MIN_VISITS = 3;
/** A new visit is a page view at least this long after the previous one (a reload or a click-through is the same visit). */
export const NEW_VISIT_AFTER_MS = 30 * 60 * 1000;
export const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export type HintState = { visits: number; last: number; closedAt: number | null; installed: boolean };
export const EMPTY: HintState = { visits: 0, last: 0, closedAt: null, installed: false };

/** What is stored, read back safely: anything that is not what we wrote is a fresh start. */
export function parseState(raw: string | null): HintState {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as Partial<HintState>;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
    return { visits: Math.min(num(v.visits), 1000), last: num(v.last), closedAt: typeof v.closedAt === "number" && Number.isFinite(v.closedAt) ? v.closedAt : null, installed: v.installed === true };
  } catch {
    return EMPTY;
  }
}

export function recordVisit(state: HintState, now: number): HintState {
  if (state.visits > 0 && now - state.last < NEW_VISIT_AFTER_MS) return { ...state, last: now };
  return { ...state, visits: state.visits + 1, last: now };
}
export const dismiss = (state: HintState, now: number): HintState => ({ ...state, closedAt: now });
export const markInstalled = (state: HintState): HintState => ({ ...state, installed: true });

export type Env = { phone: boolean; standalone: boolean };

export function shouldShow(state: HintState, env: Env, now: number): boolean {
  if (!env.phone || env.standalone || state.installed) return false;
  if (state.visits < MIN_VISITS) return false;
  return state.closedAt === null || now - state.closedAt >= SNOOZE_MS;
}

/** How this phone adds an app: "prompt" = the browser offered an install button (Chrome, Edge, Samsung Internet), "ios" = Safari's Share sheet, "other" = the browser menu. */
export type HowTo = "prompt" | "ios" | "other";
export function howTo(userAgent: string, hasPrompt: boolean): HowTo {
  if (hasPrompt) return "prompt";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  return "other";
}
