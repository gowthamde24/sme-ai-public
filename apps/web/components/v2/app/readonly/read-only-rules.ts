/**
 * What a read-only workspace switches off (job DP). The API refuses every change in that state (403 `workspace_read_only`); the screens say so first and do not offer a button that cannot work. A control is OFF when it is
 * - a main button of the app (`btnMain`, `btnMainLink`: the class `write-ctl`), or any submit button, or
 * - marked `data-write` (a card's "Not now", the question line of the assistant, a switch): a container marked so switches off every control inside it.
 * Looking, filtering, opening and exporting stay: a region marked `data-read-ok` is never touched, and the parts of Settings that are about the person or the data (Data, Plan, Privacy, Security, Language) and the plans, privacy,
 * suppression and help screens are not touched at all.
 */
export const WRITE_SELECTOR = ".write-ctl, [data-write], button[type='submit'], input[type='submit']";
export const READ_OK_SELECTOR = "[data-read-ok]";
const CONTROLS = "button, input, select, textarea";

/** Whether the screen at this address keeps its controls (the person's own and the data's: they are never workspace changes). */
export function keepsControls(pathname: string, section: string | null): boolean {
  if (/\/(plans|privacy|suppression|help)(\/|$)/.test(pathname)) return true;
  if (/\/settings\/?$/.test(pathname)) return section !== null && ["data", "plan", "privacy", "security", "language"].includes(section);
  return false;
}

/** Switches off what must be off under `root`; returns how many controls it changed. */
export function switchOff(root: ParentNode, why: string): number {
  let n = 0;
  root.querySelectorAll<HTMLElement>(WRITE_SELECTOR).forEach((el) => {
    if (el.closest(READ_OK_SELECTOR)) return;
    const own = el.matches(CONTROLS) ? [el] : [...el.querySelectorAll<HTMLElement>(CONTROLS)];
    for (const c of own) {
      if (c.closest(READ_OK_SELECTOR) || c.hasAttribute("data-readonly-off")) continue;
      if (c instanceof HTMLInputElement && c.type === "hidden") continue;
      const control = c as HTMLButtonElement;
      if (control.disabled) continue;
      control.disabled = true;
      c.setAttribute("data-readonly-off", "");
      c.setAttribute("title", why);
      n++;
    }
    if (el.matches("a")) {
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("tabindex", "-1");
      el.setAttribute("data-readonly-off", "");
      el.setAttribute("title", why);
      n++;
    }
  });
  return n;
}

/** Puts back what `switchOff` changed (the workspace paid, or the person went to a screen that keeps its controls). */
export function switchOn(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-readonly-off]").forEach((el) => {
    (el as HTMLButtonElement).disabled = false;
    el.removeAttribute("data-readonly-off");
    el.removeAttribute("aria-disabled");
    if (el.getAttribute("tabindex") === "-1" && el.matches("a")) el.removeAttribute("tabindex");
    el.removeAttribute("title");
  });
}
