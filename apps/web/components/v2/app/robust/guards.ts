/**
 * The rules of the app-wide guards (job BW), pure so a test can pin them. A second press of the same button, or a second submit of the same form, inside a short window is the same press arriving twice (a
 * double tap, a slow screen): it is ignored. The server keeps its own idempotency keys for sends; this stops the second request from being made at all.
 */
export const SUBMIT_LOCK_MS = 1500;
export const CLICK_LOCK_MS = 700;

/** Buttons that are meant to be pressed again at once, or that only show or hide something, are never held back. */
const OPT_OUT_ROLES = new Set(["tab", "switch", "checkbox", "radio", "menuitemcheckbox", "menuitemradio", "slider", "spinbutton"]);

/** The button a click should be guarded on, or null when the click is not one of the guarded kind. */
export function guardedButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest("button");
  if (!button || button.disabled) return null;
  if (button.type === "submit") return null; // a submit is guarded as a submit
  if (button.hasAttribute("data-repeat") || button.closest("[data-no-guard]")) return null;
  if (button.hasAttribute("aria-expanded") || button.hasAttribute("aria-pressed")) return null;
  const role = button.getAttribute("role");
  if (role && OPT_OUT_ROLES.has(role)) return null;
  return button;
}

/** True when `now` is too soon after `last` (both milliseconds). */
export const tooSoon = (last: number | undefined, now: number, windowMs: number): boolean => last !== undefined && now - last >= 0 && now - last < windowMs;

/**
 * Whether a click on `anchor` starts a move to another page of this app (job BW), so the page can show "Loading" at once instead of waiting for the server: a plain left click on a link to another address of the
 * same site, not a new tab, a download, a hash on this page or a modified click (which the browser handles itself).
 */
export function startsNavigation(anchor: HTMLAnchorElement | null, e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, here: { origin: string; pathname: string; search: string }): boolean {
  if (!anchor || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return false;
  let url: URL;
  try {
    url = new URL(anchor.getAttribute("href") ?? "", `${here.origin}${here.pathname}${here.search}`);
  } catch {
    return false;
  }
  if (url.origin !== here.origin) return false;
  return url.pathname !== here.pathname || url.search !== here.search;
}

/** What a form is about to send, as one string: names and values (a file by its name and size). Two submits with the same string are the same submit. */
export function formKey(form: HTMLFormElement): string {
  const parts: string[] = [screenKey()];
  new FormData(form).forEach((value, name) => parts.push(`${name}=${typeof value === "string" ? value : `file:${value.name}:${value.size}`}`));
  return parts.join("&");
}

/**
 * What the person is looking at, as a short string: the page's first heading. A step-by-step screen (a wizard) reuses the same button and the same form for each step, so "the same button again" is only a double press if the screen has not
 * moved on in between: the guards remember this string with the press and let a press through when it has changed.
 */
export function screenKey(): string {
  return (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 120);
}
