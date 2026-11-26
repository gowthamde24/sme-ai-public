import { ASK_FIRST, EMPLOYEE_LANGUAGES, REFUSALS, STATUSES, STYLES, isRole, type ActivityCall, type Autonomy, type Employee, type EmployeeList, type EmployeePatch, type EmployeeStatus, type Fail, type Hours, type Refusal } from "@/lib/employees/types";

import { ApiAuthError, ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, oneOf, optInt, optStr, readRows, rec, str } from "./shape";

/**
 * The AI employees' routes (C1; contract docs/contracts/employees.md; API flag EMPLOYEES, 404 while off). SERVER ONLY, with the person's own token. Every refusal is a closed word.
 *   GET/POST ""   GET/PUT /{id} (a patch)   POST /{id}/status   PUT /{id}/voices/{language}   PUT /{id}/phone   GET /{id}/activity   POST /{id}/preview
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/employees`;
};
const path = (tenantId: string, id: string): string => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("employee id");
  return `${base(tenantId)}/${id}`;
};

const strList = (v: unknown, what: string, max: number, len: number): string[] => (v === undefined || v === null ? [] : readRows(v, what, (x) => str(x, what, len), max));

function parseAutonomy(v: unknown): Autonomy {
  const x = v === undefined || v === null ? {} : rec(v, "autonomy");
  return {
    mayAnswerPrices: x.may_answer_prices === true,
    mayBookVisits: x.may_book_visits === true,
    maySendMedia: x.may_send_media === true,
    mayTalkDues: x.may_talk_dues === true,
    maxDiscountPercent: optInt(x.max_discount_percent, "max_discount_percent", 0, 100) ?? 0,
    handoverOwnerAsked: x.handover_owner_asked !== false,
    handoverUpset: x.handover_upset !== false,
    handoverOrderAbovePaise: optInt(x.handover_order_above_paise, "handover_order_above_paise", 0, 100_000_000_000),
  };
}
function parseHours(v: unknown): Hours | null {
  if (v === undefined || v === null) return null;
  const x = rec(v, "hours");
  return { days: readRows(x.days, "days", (d) => int(d, "day", 1, 7), 7), fromMinute: int(x.from_minute, "from_minute", 0, 1440), toMinute: int(x.to_minute, "to_minute", 0, 1440) };
}
export function parseEmployee(row: unknown): Employee {
  const x = rec(row, "employee");
  const voices: Record<string, string> = {};
  if (typeof x.voices === "object" && x.voices !== null && !Array.isArray(x.voices)) for (const [k, val] of Object.entries(x.voices)) if (typeof val === "string") voices[k] = val;
  const opening: Record<string, string> = {};
  if (typeof x.opening_line === "object" && x.opening_line !== null && !Array.isArray(x.opening_line)) for (const [k, val] of Object.entries(x.opening_line)) if (typeof val === "string") opening[k] = val;
  return {
    id: str(x.id, "id", 64),
    name: str(x.name, "name", 60),
    roleCode: isRole(x.role_code) ? x.role_code : "custom",
    roleTitle: optStr(x.role_title, "role_title", 200),
    status: oneOf(x.status, STATUSES, "status"),
    isDefault: bool(x.is_default, "is_default"),
    responsibilities: strList(x.responsibilities, "responsibilities", 30, 60),
    extraInstructions: optStr(x.extra_instructions, "extra_instructions", 4000),
    languages: strList(x.languages, "languages", 10, 10),
    autoSwitchLanguage: x.auto_switch_language !== false,
    allowEnglishMixing: x.allow_english_mixing !== false,
    style: x.style === null || x.style === undefined ? null : oneOf(x.style, STYLES, "style"),
    speed: typeof x.speed === "number" && Number.isFinite(x.speed) ? x.speed : null,
    openingLine: opening,
    autonomy: parseAutonomy(x.autonomy),
    askFirst: strList(x.ask_first, "ask_first", 20, 40),
    hours: parseHours(x.hours),
    neverSay: strList(x.never_say, "never_say", 40, 200),
    phoneNumberId: optStr(x.phone_number_id, "phone_number_id", 64),
    personaIn: x.persona_in === "my_assistant" ? "my_assistant" : "employee",
    voices,
    callsToday: optInt(x.calls_today, "calls_today", 0, 1_000_000) ?? 0,
  };
}
export function parseEmployees(json: unknown): EmployeeList {
  const x = rec(json, "employees");
  return { employees: readRows(x.employees, "employees", parseEmployee, 20), limit: int(x.limit, "limit", 1, 100) };
}
export function parseActivity(json: unknown): ActivityCall[] {
  const x = rec(json, "activity");
  return readRows(x.calls, "calls", (row) => {
    const c = rec(row, "call");
    return { id: str(c.id, "id", 64), direction: str(c.direction, "direction", 20), state: str(c.state, "state", 40), purpose: optStr(c.purpose, "purpose", 100), language: optStr(c.language, "language", 10), outcome: optStr(c.outcome, "outcome", 100), durationS: optInt(c.duration_s, "duration_s", 0, 100_000), createdAt: str(c.created_at, "created_at", 40) };
  }, 100);
}

/** A refusal of the API as a closed word; anything else is "unavailable" and a lost session goes on to sign-in. */
export function refusalOf(error: unknown): Fail {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    const word = error.reason ?? error.code;
    const found: Refusal = (REFUSALS as readonly string[]).includes(word) ? (word as Refusal) : error.status === 403 ? "forbidden" : error.status === 404 ? "not_found" : error.status === 422 ? "validation_error" : "unavailable";
    return { ok: false, error: found };
  }
  return { ok: false, error: "unavailable" };
}

export const getEmployees = async (token: string, tenantId: string): Promise<EmployeeList> => parseEmployees(await apiRequest(base(tenantId), token));
export const getEmployee = async (token: string, tenantId: string, id: string): Promise<Employee> => parseEmployee(await apiRequest(path(tenantId, id), token));
export async function createEmployee(token: string, tenantId: string, input: { id: string; roleCode: string; name: string }): Promise<Employee> {
  return parseEmployee(await apiRequest(base(tenantId), token, { method: "POST", body: JSON.stringify({ id: input.id, role_code: input.roleCode, name: input.name }) }));
}

/** The patch as the API's own words (snake_case); only what is named is sent. */
export function wirePatch(p: EmployeePatch): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (p.name !== undefined) o.name = p.name;
  if (p.roleCode !== undefined) o.role_code = p.roleCode;
  if (p.roleTitle !== undefined) o.role_title = p.roleTitle;
  if (p.responsibilities !== undefined) o.responsibilities = p.responsibilities;
  if (p.extraInstructions !== undefined) o.extra_instructions = p.extraInstructions;
  if (p.neverSay !== undefined) o.never_say = p.neverSay;
  if (p.languages !== undefined) o.languages = p.languages;
  if (p.autoSwitchLanguage !== undefined) o.auto_switch_language = p.autoSwitchLanguage;
  if (p.allowEnglishMixing !== undefined) o.allow_english_mixing = p.allowEnglishMixing;
  if (p.style !== undefined) o.style = p.style;
  if (p.speed !== undefined) o.speed = p.speed;
  if (p.openingLine !== undefined) o.opening_line = p.openingLine;
  if (p.askFirst !== undefined) o.ask_first = p.askFirst;
  if (p.hours !== undefined) o.hours = p.hours === null ? null : { days: p.hours.days, from_minute: p.hours.fromMinute, to_minute: p.hours.toMinute };
  if (p.autonomy !== undefined) {
    const a = p.autonomy;
    const w: Record<string, unknown> = {};
    if (a.mayAnswerPrices !== undefined) w.may_answer_prices = a.mayAnswerPrices;
    if (a.mayBookVisits !== undefined) w.may_book_visits = a.mayBookVisits;
    if (a.maySendMedia !== undefined) w.may_send_media = a.maySendMedia;
    if (a.mayTalkDues !== undefined) w.may_talk_dues = a.mayTalkDues;
    if (a.maxDiscountPercent !== undefined) w.max_discount_percent = a.maxDiscountPercent;
    if (a.handoverOwnerAsked !== undefined) w.handover_owner_asked = a.handoverOwnerAsked;
    if (a.handoverUpset !== undefined) w.handover_upset = a.handoverUpset;
    if (a.handoverOrderAbovePaise !== undefined) w.handover_order_above_paise = a.handoverOrderAbovePaise;
    o.autonomy = w;
  }
  return o;
}
export async function patchEmployee(token: string, tenantId: string, id: string, patch: EmployeePatch): Promise<Employee> {
  return parseEmployee(await apiRequest(path(tenantId, id), token, { method: "PUT", body: JSON.stringify(wirePatch(patch)) }));
}
export async function setEmployeeStatus(token: string, tenantId: string, id: string, status: Exclude<EmployeeStatus, "draft">): Promise<Employee> {
  return parseEmployee(await apiRequest(`${path(tenantId, id)}/status`, token, { method: "POST", body: JSON.stringify({ status }) }));
}
export async function setEmployeeVoice(token: string, tenantId: string, id: string, language: string, voiceCode: string): Promise<Employee> {
  if (!(EMPLOYEE_LANGUAGES as readonly string[]).includes(language)) bad("language");
  return parseEmployee(await apiRequest(`${path(tenantId, id)}/voices/${language}`, token, { method: "PUT", body: JSON.stringify({ voice_code: voiceCode }) }));
}
export async function setEmployeePhone(token: string, tenantId: string, id: string, phoneNumberId: string | null): Promise<Employee> {
  return parseEmployee(await apiRequest(`${path(tenantId, id)}/phone`, token, { method: "PUT", body: JSON.stringify({ phone_number_id: phoneNumberId }) }));
}
export async function getEmployeeActivity(token: string, tenantId: string, id: string, query: { limit?: number; before?: string } = {}): Promise<ActivityCall[]> {
  const q = new URLSearchParams();
  if (query.limit) q.set("limit", String(query.limit));
  if (query.before) q.set("before", query.before);
  return parseActivity(await apiRequest(`${path(tenantId, id)}/activity${q.size ? `?${q}` : ""}`, token));
}
export type EmployeePreview = { readonly spokenText: string; readonly mime: string; readonly base64: string; readonly voiceId: string | null };
export async function previewEmployee(token: string, tenantId: string, id: string, input: { language: string; text?: string }): Promise<EmployeePreview> {
  const x = rec(await apiRequest(`${path(tenantId, id)}/preview`, token, { method: "POST", body: JSON.stringify(input) }), "preview");
  const audio = rec(x.audio, "audio");
  return { spokenText: str(x.spoken_text, "spoken_text", 1000), mime: str(audio.mime, "mime", 40), base64: str(audio.base64, "base64", 8_000_000), voiceId: optStr(x.voice_id, "voice_id", 100) };
}
export const ASK_FIRST_SET: ReadonlySet<string> = new Set(ASK_FIRST);
