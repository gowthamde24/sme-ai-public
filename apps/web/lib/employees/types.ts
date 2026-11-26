/**
 * AI employees (owner, 26 Nov 2026; C1's contract docs/contracts/employees.md, API flag EMPLOYEES, web flag EMPLOYEES). The words on screen come from the string store (`emp.*`); the codes below are the API's closed words.
 * A workspace has ONE default employee (today's assistant, persona kept in My assistant) and, on a paid plan, up to four more; the owner's Today assistant is not an employee.
 */
export const ROLE_CODES = ["receptionist", "sales", "follow_up", "collections", "support", "appointments", "custom"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];
/** Channels an AI employee has only when the owner ticks them (owner rule 26 Nov 2026: WhatsApp is optional). */
export const CHANNEL_RESPONSIBILITIES = ["channel_phone", "channel_whatsapp", "channel_web_chat"] as const;
export type ChannelResponsibility = (typeof CHANNEL_RESPONSIBILITIES)[number];
export const RESPONSIBILITIES = ["enquiry_reply", "faq_answers", "visit_booking", "quote_chase", "lead_qualify", "follow_up", "review_request", "payment_reminder", "appointment_reminder"] as const;
export type Responsibility = (typeof RESPONSIBILITIES)[number];
export const ASK_FIRST = ["send_message", "make_call", "give_discount", "promise_date", "book_visit", "share_price", "send_media"] as const;
export type AskFirst = (typeof ASK_FIRST)[number];
/** What a new employee asks the owner about first: everything that sends or promises. */
export const ASK_FIRST_DEFAULT: readonly AskFirst[] = ["send_message", "make_call", "give_discount", "promise_date"];
export const STYLES = ["friendly", "respectful", "quick", "casual"] as const;
export type EmployeeStyle = (typeof STYLES)[number];
export const STATUSES = ["draft", "on", "paused", "archived"] as const;
export type EmployeeStatus = (typeof STATUSES)[number];
export const EMPLOYEE_LANGUAGES = ["te", "hi", "kn", "en"] as const;
export type EmployeeLanguage = (typeof EMPLOYEE_LANGUAGES)[number];

export const NAME_MAX = 24;
export const ROLE_TITLE_MIN = 3;
export const ROLE_TITLE_MAX = 60;
export const INSTRUCTIONS_MAX = 1500;
export const NEVER_SAY_MAX = 30;
export const NEVER_SAY_LEN = 60;
/** The legal calling window (India time, minutes of the day): an employee's own hours can only be inside it. */
export const WINDOW_FROM = 10 * 60;
export const WINDOW_TO = 21 * 60;

export type Autonomy = {
  readonly mayAnswerPrices: boolean;
  readonly mayBookVisits: boolean;
  readonly maySendMedia: boolean;
  readonly mayTalkDues: boolean;
  readonly maxDiscountPercent: number;
  readonly handoverOwnerAsked: boolean;
  readonly handoverUpset: boolean;
  readonly handoverOrderAbovePaise: number | null;
};
/** Days 1 (Monday) to 7 (Sunday); minutes of the day in India time. */
export type Hours = { readonly days: readonly number[]; readonly fromMinute: number; readonly toMinute: number };

export type Employee = {
  readonly id: string;
  readonly name: string;
  readonly roleCode: RoleCode;
  readonly roleTitle: string | null;
  readonly status: EmployeeStatus;
  readonly isDefault: boolean;
  readonly responsibilities: readonly string[];
  readonly extraInstructions: string | null;
  readonly languages: readonly string[];
  readonly autoSwitchLanguage: boolean;
  readonly allowEnglishMixing: boolean;
  readonly style: EmployeeStyle | null;
  readonly speed: number | null;
  readonly openingLine: Readonly<Record<string, string>>;
  readonly autonomy: Autonomy;
  readonly askFirst: readonly string[];
  readonly hours: Hours | null;
  readonly neverSay: readonly string[];
  readonly phoneNumberId: string | null;
  readonly personaIn: "my_assistant" | "employee";
  readonly voices: Readonly<Record<string, string>>;
  readonly callsToday: number;
  /** this employee's own channels, and what is still needed for them (C1, migration 992780) */
  readonly channels: { readonly phone: boolean; readonly whatsapp: boolean; readonly webChat: boolean };
  readonly needs: readonly ChannelNeed[];
};
/** What an employee still needs before a channel it has works (C1: `needs`): turning a channel on never fails, the screen shows the step. */
export type ChannelNeed = { readonly channel: "whatsapp"; readonly step: "connect_whatsapp" | "activate_whatsapp" };
export type Channels = { readonly phone: boolean; readonly whatsapp: boolean; readonly webChat: boolean; readonly whatsappConnection: { readonly status: "none" | "pending" | "active" | "disabled"; readonly connected: boolean; readonly nextStep: "connect_whatsapp" | "activate_whatsapp" | null } };
export type EmployeeList = { readonly employees: readonly Employee[]; readonly limit: number; readonly channels: Channels | null };

export type ActivityCall = { readonly id: string; readonly direction: string; readonly state: string; readonly purpose: string | null; readonly language: string | null; readonly outcome: string | null; readonly durationS: number | null; readonly createdAt: string };

/** The closed refusals of the routes, drawn as plain sentences by the screen (`emp.err.*`), never the API's own text. */
export const REFUSALS = ["employee_limit", "name_taken", "last_default", "settings_elsewhere", "hours_wider", "validation_error", "voice_unavailable", "rate_limited", "forbidden", "not_found", "unavailable"] as const;
export type Refusal = (typeof REFUSALS)[number];
export type Fail = { readonly ok: false; readonly error: Refusal };
export type Done<T> = { readonly ok: true; readonly data: T } | Fail;

/** What a PUT /employees/{id} may carry (a patch: what is left out is kept; `null` clears the ones the contract names). */
export type EmployeePatch = {
  name?: string;
  roleCode?: RoleCode;
  roleTitle?: string | null;
  responsibilities?: readonly string[];
  extraInstructions?: string | null;
  neverSay?: readonly string[];
  languages?: readonly string[];
  autoSwitchLanguage?: boolean;
  allowEnglishMixing?: boolean;
  style?: EmployeeStyle | null;
  speed?: number | null;
  openingLine?: Readonly<Record<string, string>>;
  autonomy?: Partial<{ mayAnswerPrices: boolean; mayBookVisits: boolean; maySendMedia: boolean; mayTalkDues: boolean; maxDiscountPercent: number; handoverOwnerAsked: boolean; handoverUpset: boolean; handoverOrderAbovePaise: number | null }>;
  askFirst?: readonly AskFirst[];
  hours?: Hours | null;
};

export const isRole = (v: unknown): v is RoleCode => (ROLE_CODES as readonly unknown[]).includes(v);
export const hhmm = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
/** "10:00" to minutes of the day, or null. */
export const minuteOf = (text: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) <= 24 && Number(m[2]) < 60 ? n : null;
};
export const hoursOk = (h: Hours): boolean => h.days.length > 0 && h.days.every((d) => d >= 1 && d <= 7) && h.fromMinute >= WINDOW_FROM && h.toMinute <= WINDOW_TO && h.fromMinute < h.toMinute;
