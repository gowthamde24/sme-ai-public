import { ASK_FIRST_DEFAULT, INSTRUCTIONS_MAX, NAME_MAX, NEVER_SAY_LEN, NEVER_SAY_MAX, ROLE_TITLE_MAX, ROLE_TITLE_MIN, WINDOW_FROM, WINDOW_TO, hoursOk, minuteOf, type AskFirst, type Done, type Employee, type EmployeePatch, type Hours, type RoleCode } from "@/lib/employees/types";
import type { EmployeePreview } from "@/lib/api/employees";
import type { PickerLang } from "@/lib/voice-picker/types";

/** The seven screens of the wizard, in order. */
export const STEPS = ["role", "name", "voice", "rules", "jobs", "preview", "on"] as const;
export type Step = (typeof STEPS)[number];
/** The languages an AI employee can speak, in the order the voice picker offers them (owner, 9 Nov 2026). */
export const WIZARD_LANGS = ["te", "kn", "en", "hi"] as const satisfies readonly PickerLang[];
export type WizardLang = (typeof WIZARD_LANGS)[number];

/** One voice of the catalogue, as much of it as the wizard draws. */
export type WizardVoice = { id: string; language: WizardLang; name: string; label: string; gender: "female" | "male"; recommended: boolean };

/** The server actions of the wizard, already bound to the workspace by the page. */
export type WizardActions = {
  create: (input: { id: string; roleCode: RoleCode; name: string }) => Promise<Done<Employee>>;
  patch: (id: string, patch: EmployeePatch) => Promise<Done<Employee>>;
  setVoice: (id: string, language: string, voiceCode: string) => Promise<Done<Employee>>;
  preview: (id: string, input: { language: string }) => Promise<Done<EmployeePreview>>;
  setStatus: (id: string, status: "on") => Promise<Done<Employee>>;
};

/** Everything the person has chosen so far: kept in the browser until each step is saved to the draft employee. */
export type Draft = {
  role: RoleCode | null;
  name: string;
  languages: WizardLang[];
  voices: Partial<Record<WizardLang, string>>;
  askFirst: AskFirst[];
  hoursMode: "same" | "only";
  days: number[];
  from: string;
  to: string;
  neverSay: string[];
  instructions: string;
  responsibilities: string[];
  /** the person has changed the responsibilities: a later answer of the API (a new role) no longer replaces them */
  respTouched: boolean;
  roleTitle: string;
};
export const initialDraft = (): Draft => ({ role: null, name: "", languages: ["te", "en"], voices: {}, askFirst: [...ASK_FIRST_DEFAULT], hoursMode: "same", days: [1, 2, 3, 4, 5, 6], from: "10:00", to: "21:00", neverSay: [], instructions: "", responsibilities: [], respTouched: false, roleTitle: "" });

/** A plain sentence for the screen: a key of the string store and its numbers. */
export type Problem = { key: string; vars?: Record<string, string | number> };

export type VoiceCatalogue = readonly WizardVoice[];
/** The catalogue's voices for one language: women first, then men, one row for each name. */
export function voicesFor(all: VoiceCatalogue, language: WizardLang): WizardVoice[] {
  const mine = all.filter((v) => v.language === language);
  const seen = new Set<string>();
  const once = (list: WizardVoice[]) => list.filter((v) => (seen.has(v.name) ? false : (seen.add(v.name), true)));
  return [...once(mine.filter((v) => v.gender === "female")), ...once(mine.filter((v) => v.gender === "male"))];
}

/** The working hours of the draft as the API wants them, or the sentence that says what is wrong. `null` hours = the same as the business. */
export function hoursOf(d: Draft): { ok: true; hours: Hours | null } | { ok: false; problem: Problem } {
  if (d.hoursMode === "same") return { ok: true, hours: null };
  if (d.days.length === 0) return { ok: false, problem: { key: "emp.wiz.err.hours_days" } };
  const from = minuteOf(d.from);
  const to = minuteOf(d.to);
  if (from === null || to === null || from >= to) return { ok: false, problem: { key: "emp.wiz.err.hours_time" } };
  const hours: Hours = { days: [...d.days].sort((a, b) => a - b), fromMinute: from, toMinute: to };
  if (from < WINDOW_FROM || to > WINDOW_TO || !hoursOk(hours)) return { ok: false, problem: { key: "emp.err.hours_wider" } };
  return { ok: true, hours };
}

/** What a step needs before "Next" goes on: the plain sentence, or null when it is fine. */
export function problemOf(step: Step, d: Draft, hasVoices: (l: WizardLang) => boolean): Problem | null {
  switch (step) {
    case "role":
      return d.role ? null : { key: "emp.wiz.err.role" };
    case "name":
      if (d.name.trim() === "") return { key: "emp.wiz.err.name_empty" };
      return d.name.trim().length > NAME_MAX ? { key: "emp.wiz.err.name_long", vars: { max: NAME_MAX } } : null;
    case "voice":
      if (d.languages.length === 0) return { key: "emp.wiz.err.langs" };
      return d.languages.some((l) => hasVoices(l) && !d.voices[l]) ? { key: "emp.wiz.err.voice", vars: { language: d.languages.find((l) => hasVoices(l) && !d.voices[l]) ?? "" } } : null;
    case "rules": {
      if (d.instructions.length > INSTRUCTIONS_MAX) return { key: "emp.wiz.err.instr_long", vars: { max: INSTRUCTIONS_MAX } };
      const h = hoursOf(d);
      return h.ok ? null : h.problem;
    }
    case "jobs": {
      const title = d.roleTitle.trim();
      if (title !== "" && (title.length < ROLE_TITLE_MIN || title.length > ROLE_TITLE_MAX)) return { key: "emp.wiz.err.title_short", vars: { min: ROLE_TITLE_MIN, max: ROLE_TITLE_MAX } };
      return d.responsibilities.length === 0 && title === "" ? { key: "emp.wiz.err.need_job" } : null;
    }
    default:
      return null;
  }
}

/** The rules of step 4 as one patch (an empty instruction box clears the text, "same as the business" clears the hours). */
export function rulesPatch(d: Draft): EmployeePatch | null {
  const h = hoursOf(d);
  if (!h.ok) return null;
  return { askFirst: d.askFirst, hours: h.hours, neverSay: d.neverSay, extraInstructions: d.instructions.trim() === "" ? null : d.instructions };
}
export const NEVER = { max: NEVER_SAY_MAX, len: NEVER_SAY_LEN };
