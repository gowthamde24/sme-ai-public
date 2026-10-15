import type {
  AdmissionDetailOut, AdmissionOut, AdmittedOut, AssignedOut, AssignmentOut, AssignmentVoidedOut, AudienceAddedOut, FeeEntriesOut, FeeEntryOut, FeePlanDetailOut, FeePlanOut, FeeReceiptOut, GroupOut, GuardianFeesOut,
  LateFeesPostedOut, LateFeesPreviewOut, PendingRowOut, ProfileOut, ProgrammeOut, StageChangedOut, StudentOut,
} from "@contracts/education";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parseStatement } from "./ledger";
import { bad, bool, int, iso, list, nstr, oneOf, optInt, optStr, rec, str, uuid } from "./shape";

/**
 * The education core (job CR on the API, ADR 0087; read by the screens of job CS; module `programmes`, and `fees` for money): the institution, programmes and sections, the MINIMUM student record, admissions, fee plans and
 * the fee ledger of each student. Server side only, with the signed-in user's own token. Owner, Admin and Sales read; Owner and Admin write (an admission and a payment may also be written by Sales). A student is a first name or
 * initials, a placement and the adult we write to: nothing else exists, and these readers accept nothing else a child could be named by. Money is integer paise.
 */
export const INSTITUTION_TYPES = ["school", "junior_college", "degree_college", "university", "coaching", "training"] as const;
export const PARENT_LANGUAGES = ["en", "te", "hi", "kn", "ta"] as const;
export const PROGRAMME_KINDS = ["class", "course"] as const;
export const GROUP_KINDS = ["section", "year", "semester", "batch", "none"] as const;
export const SOURCES = ["whatsapp", "walk_in", "website", "ad", "referral", "other"] as const;
export const STAGES = ["enquiry", "campus_visit", "application", "admitted", "lost"] as const;
export const LOST_REASONS = ["fees", "distance", "other_school", "not_interested", "no_response", "other"] as const;
export const HEADS = ["tuition", "admission", "transport", "hostel", "exam", "books", "other"] as const;
export const LATE_KINDS = ["none", "fixed", "per_day"] as const;
export const METHODS = ["cash", "upi", "bank_transfer", "cheque", "card", "other"] as const;
export const CONCESSION_REASONS = ["scholarship", "sibling", "staff_ward", "hardship", "merit", "other"] as const;
export const ADJUSTMENT_REASONS = ["correction", "waiver", "rounding", "other"] as const;
export const STUDENT_STATUSES = ["active", "left"] as const;
export const MAX_PAISE = 10_000_000_000;
export type Source = (typeof SOURCES)[number];
export type Stage = (typeof STAGES)[number];
export type LostReason = (typeof LOST_REASONS)[number];
export type Head = (typeof HEADS)[number];
export type Method = (typeof METHODS)[number];

const day = (v: unknown, what: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bad(what));
const optDay = (v: unknown, what: string) => (v === null || v === undefined ? null : day(v, what));
const optUuid = (v: unknown, what: string) => (v === null || v === undefined ? null : uuid(v, what));
const paise = (v: unknown, what: string) => int(v, what, 0, MAX_PAISE);

// ------------------------------------------------------------------------------------------------------------------------------------------------ readers
export function parseProfile(json: unknown): ProfileOut {
  const r = rec(json, "profile");
  const terms = (v: unknown) => (v === undefined ? [] : list(v, "terms", 6).map((t) => { const x = rec(t, "term"); return { label: nstr(x.label, "label", 40), start_month: int(x.start_month, "start_month", 1, 12), end_month: int(x.end_month, "end_month", 1, 12) }; }));
  return {
    configured: bool(r.configured, "configured"),
    institution_type: r.institution_type === null || r.institution_type === undefined ? null : oneOf(r.institution_type, INSTITUTION_TYPES, "institution_type"),
    year_start_month: optInt(r.year_start_month, "year_start_month", 1, 12),
    terms: terms(r.terms),
    parent_languages: r.parent_languages === undefined ? [] : list(r.parent_languages, "parent_languages", 5).map((l) => oneOf(l, PARENT_LANGUAGES, "language")),
    student_retention_months: optInt(r.student_retention_months, "student_retention_months", 1, 240),
    updated_at: r.updated_at === null || r.updated_at === undefined ? null : iso(r.updated_at, "updated_at"),
  };
}

function parseGroup(json: unknown): GroupOut {
  const r = rec(json, "group");
  return { id: uuid(r.id, "id"), label: nstr(r.label, "label", 80), timing: optStr(r.timing, "timing", 80), active: bool(r.active, "active"), students: int(r.students, "students", 0, 100_000) };
}

export function parseProgramme(json: unknown): ProgrammeOut {
  const r = rec(json, "programme");
  return {
    id: uuid(r.id, "id"),
    name: nstr(r.name, "name", 80),
    kind: oneOf(r.kind, PROGRAMME_KINDS, "kind"),
    group_kind: oneOf(r.group_kind, GROUP_KINDS, "group_kind"),
    active: bool(r.active, "active"),
    students: int(r.students, "students", 0, 1_000_000),
    groups: list(r.groups, "groups", 100).map(parseGroup),
  };
}

export function parseProgrammes(json: unknown): ProgrammeOut[] {
  return list(rec(json, "programmes").items, "items", 200).map(parseProgramme);
}

export function parseProgrammeSaved(json: unknown): { id: string; name: string; created: boolean } {
  const r = rec(json, "saved programme");
  return { id: uuid(r.id, "id"), name: nstr(r.name, "name", 80), created: bool(r.created, "created") };
}

export function parseGroupSaved(json: unknown): { id: string; programme_id: string; label: string; created: boolean } {
  const r = rec(json, "saved group");
  return { id: uuid(r.id, "id"), programme_id: uuid(r.programme_id, "programme_id"), label: nstr(r.label, "label", 80), created: bool(r.created, "created") };
}

export function parseStudent(json: unknown): StudentOut {
  const r = rec(json, "student");
  const erased = bool(r.erased, "erased");
  return {
    id: uuid(r.id, "id"),
    contact_id: uuid(r.contact_id, "contact_id"),
    is_adult: bool(r.is_adult, "is_adult"),
    display_name: optStr(r.display_name, "display_name", 80),
    contact_name: optStr(r.contact_name, "contact_name", 200),
    guardian_contact_id: optUuid(r.guardian_contact_id, "guardian_contact_id"),
    programme_id: uuid(r.programme_id, "programme_id"),
    group_id: optUuid(r.group_id, "group_id"),
    programme_name: optStr(r.programme_name, "programme_name", 80),
    group_label: optStr(r.group_label, "group_label", 80),
    admission_no: optStr(r.admission_no, "admission_no", 40),
    status: oneOf(r.status, STUDENT_STATUSES, "status"),
    joined_on: optDay(r.joined_on, "joined_on"),
    left_on: optDay(r.left_on, "left_on"),
    erased,
    created_at: iso(r.created_at, "created_at"),
    updated_at: iso(r.updated_at, "updated_at"),
  };
}

export function parseStudentList(json: unknown): { items: StudentOut[]; next_cursor: string | null } {
  const r = rec(json, "students");
  return { items: list(r.items, "items", 100).map(parseStudent), next_cursor: optStr(r.next_cursor, "next_cursor", 400) };
}

export function parseStudentSaved(json: unknown): { student: StudentOut; created: boolean } {
  const r = rec(json, "saved student");
  return { student: parseStudent(r), created: bool(r.created, "created") };
}

const admissionFields = (r: Record<string, unknown>): AdmissionOut => ({
  id: uuid(r.id, "id"),
  lead_id: uuid(r.lead_id, "lead_id"),
  contact_id: uuid(r.contact_id, "contact_id"),
  contact_name: optStr(r.contact_name, "contact_name", 200),
  programme_id: optUuid(r.programme_id, "programme_id"),
  programme_name: optStr(r.programme_name, "programme_name", 80),
  source: oneOf(r.source, SOURCES, "source"),
  stage: oneOf(r.stage, STAGES, "stage"),
  lost_reason: r.lost_reason === null || r.lost_reason === undefined ? null : oneOf(r.lost_reason, LOST_REASONS, "lost_reason"),
  student_id: optUuid(r.student_id, "student_id"),
  stage_at: iso(r.stage_at, "stage_at"),
  created_at: iso(r.created_at, "created_at"),
  visits: int(r.visits, "visits", 0, 1000),
  next_visit: r.next_visit === null || r.next_visit === undefined ? null : iso(r.next_visit, "next_visit"),
});

export function parseAdmission(json: unknown): AdmissionOut {
  return admissionFields(rec(json, "admission"));
}
export function parseAdmissionList(json: unknown): { items: AdmissionOut[]; next_cursor: string | null } {
  const r = rec(json, "admissions");
  return { items: list(r.items, "items", 100).map(parseAdmission), next_cursor: optStr(r.next_cursor, "next_cursor", 400) };
}
export function parseAdmissionDetail(json: unknown): AdmissionDetailOut {
  const r = rec(json, "admission");
  return {
    ...admissionFields(r),
    events: list(r.events, "events", 50).map((e) => {
      const x = rec(e, "event");
      return { stage: oneOf(x.stage, STAGES, "stage"), lost_reason: x.lost_reason === null || x.lost_reason === undefined ? null : oneOf(x.lost_reason, LOST_REASONS, "lost_reason"), at: iso(x.at, "at") };
    }),
  };
}
export function parseAdmissionCreated(json: unknown): { admission: AdmissionOut; created: boolean } {
  const r = rec(json, "created admission");
  return { admission: admissionFields(r), created: bool(r.created, "created") };
}
export function parseStageChanged(json: unknown): StageChangedOut {
  const r = rec(json, "stage change");
  return { ...admissionFields(r), replayed: r.replayed === true };
}
export function parseAdmitted(json: unknown): AdmittedOut {
  const r = rec(json, "admitted");
  return { ...admissionFields(r), replayed: r.replayed === true, student_created: r.student_created === undefined || r.student_created === null ? null : bool(r.student_created, "student_created") };
}

const planFields = (r: Record<string, unknown>): FeePlanOut => ({
  id: uuid(r.id, "id"),
  name: nstr(r.name, "name", 80),
  programme_id: uuid(r.programme_id, "programme_id"),
  group_id: optUuid(r.group_id, "group_id"),
  academic_year: str(r.academic_year, "academic_year", 9),
  late_fee_kind: oneOf(r.late_fee_kind, LATE_KINDS, "late_fee_kind"),
  late_fee_paise: optInt(r.late_fee_paise, "late_fee_paise", 0, MAX_PAISE),
  late_fee_grace_days: int(r.late_fee_grace_days, "late_fee_grace_days", 0, 365),
  late_fee_cap_paise: optInt(r.late_fee_cap_paise, "late_fee_cap_paise", 0, MAX_PAISE),
  active: bool(r.active, "active"),
  created_at: iso(r.created_at, "created_at"),
  total_paise: paise(r.total_paise, "total_paise"),
  assigned: int(r.assigned, "assigned", 0, 1_000_000),
});
export function parseFeePlanList(json: unknown): FeePlanOut[] {
  return list(rec(json, "fee plans").items, "items", 200).map((p) => planFields(rec(p, "fee plan")));
}
export function parseFeePlan(json: unknown): FeePlanDetailOut {
  const r = rec(json, "fee plan");
  return {
    ...planFields(r),
    lines: list(r.lines, "lines", 60).map((l) => {
      const x = rec(l, "fee line");
      return { head: oneOf(x.head, HEADS, "head"), instalment_no: int(x.instalment_no, "instalment_no", 1, 60), due_date: day(x.due_date, "due_date"), amount_paise: int(x.amount_paise, "amount_paise", 1, 100_000_000) };
    }),
  };
}

export function parseAssigned(json: unknown): AssignedOut {
  const r = rec(json, "assignment");
  return { assignment_id: uuid(r.assignment_id, "assignment_id"), student_id: uuid(r.student_id, "student_id"), plan_id: uuid(r.plan_id, "plan_id"), charges: optInt(r.charges, "charges", 0, 1000), total_paise: optInt(r.total_paise, "total_paise", 0, MAX_PAISE), voided: r.voided === undefined || r.voided === null ? null : bool(r.voided, "voided"), replayed: r.replayed === true };
}
export function parseAssignmentVoided(json: unknown): AssignmentVoidedOut {
  const r = rec(json, "voided assignment");
  return { assignment_id: uuid(r.assignment_id, "assignment_id"), voided: bool(r.voided, "voided"), charges_voided: int(r.charges_voided, "charges_voided", 0, 1000) };
}

function parseAssignment(json: unknown): AssignmentOut {
  const r = rec(json, "assignment");
  return { id: uuid(r.id, "id"), plan_id: uuid(r.plan_id, "plan_id"), academic_year: str(r.academic_year, "academic_year", 9), assigned_on: day(r.assigned_on, "assigned_on"), plan_name: nstr(r.plan_name, "plan_name", 80) };
}

/** The fee statement of one student: the student, the plan they hold and the ledger's own statement (the same shape as everywhere). */
export function parseFeeStatement(json: unknown): { student: StudentOut; assignment: AssignmentOut | null; statement: ReturnType<typeof parseStatement> } {
  const r = rec(json, "fee statement");
  return { student: parseStudent(r.student), assignment: r.assignment === null || r.assignment === undefined ? null : parseAssignment(r.assignment), statement: parseStatement(r.statement) };
}

export type FeeStatementResult = ReturnType<typeof parseFeeStatement>;

export function parseFeeEntry(json: unknown): FeeEntryOut {
  const r = rec(json, "fee entry");
  return {
    id: uuid(r.id, "id"),
    kind: oneOf(r.kind, ["charge", "payment", "adjustment", "concession"] as const, "kind"),
    direction: oneOf(r.direction, ["debit", "credit"] as const, "direction"),
    amount_paise: paise(r.amount_paise, "amount_paise"),
    entry_date: day(r.entry_date, "entry_date"),
    due_date: optDay(r.due_date, "due_date"),
    reference: optStr(r.reference, "reference", 80),
    method: r.method === null || r.method === undefined ? null : oneOf(r.method, METHODS, "method"),
    reason_code: optStr(r.reason_code, "reason_code", 40),
    receipt_no: optStr(r.receipt_no, "receipt_no", 40),
    against_entry_id: optUuid(r.against_entry_id, "against_entry_id"),
    source: oneOf(r.source, ["manual", "import"] as const, "source"),
    voided: bool(r.voided, "voided"),
  };
}
export function parseFeeEntries(json: unknown): FeeEntriesOut {
  const r = rec(json, "fee entries");
  return { account_id: optUuid(r.account_id, "account_id"), entries: list(r.entries, "entries", 600).map(parseFeeEntry) };
}

export function parseFeeReceipt(json: unknown): FeeReceiptOut {
  const r = rec(json, "fee receipt");
  return {
    receipt_no: str(r.receipt_no, "receipt_no", 40),
    received_on: day(r.received_on, "received_on"),
    amount_paise: paise(r.amount_paise, "amount_paise"),
    method: oneOf(r.method, METHODS, "method"),
    voided: bool(r.voided, "voided"),
    business_name: str(r.business_name, "business_name", 200),
    paid_by: optStr(r.paid_by, "paid_by", 200),
    student: parseStudent(r.student),
    against: optStr(r.against, "against", 200),
    balance_after_paise: int(r.balance_after_paise, "balance_after_paise", -MAX_PAISE, MAX_PAISE),
    recorded_at: iso(r.recorded_at, "recorded_at"),
  };
}

export function parseGuardianFees(json: unknown): GuardianFeesOut {
  const r = rec(json, "guardian fees");
  return {
    contact_id: uuid(r.contact_id, "contact_id"),
    as_of: day(r.as_of, "as_of"),
    students: list(r.students, "students", 30).map((s) => {
      const x = rec(s, "guardian student");
      return { student_id: uuid(x.student_id, "student_id"), display_name: optStr(x.display_name, "display_name", 80), outstanding_paise: paise(x.outstanding_paise, "outstanding_paise"), overdue_paise: paise(x.overdue_paise, "overdue_paise") };
    }),
    outstanding_paise: paise(r.outstanding_paise, "outstanding_paise"),
    overdue_paise: paise(r.overdue_paise, "overdue_paise"),
  };
}

export function parsePending(json: unknown): { items: PendingRowOut[]; next_cursor: string | null } {
  const r = rec(json, "pending list");
  return {
    items: list(r.items, "items", 100).map((p) => {
      const x = rec(p, "pending row");
      return {
        student_id: uuid(x.student_id, "student_id"),
        display_name: optStr(x.display_name, "display_name", 80),
        programme_name: optStr(x.programme_name, "programme_name", 80),
        group_label: optStr(x.group_label, "group_label", 80),
        contact_id: uuid(x.contact_id, "contact_id"),
        contact_name: optStr(x.contact_name, "contact_name", 200),
        pending_paise: paise(x.pending_paise, "pending_paise"),
        due_paise: paise(x.due_paise, "due_paise"),
        overdue_days: int(x.overdue_days, "overdue_days", 0, 100_000),
      };
    }),
    next_cursor: optStr(r.next_cursor, "next_cursor", 400),
  };
}

export function parseLateFeesPreview(json: unknown): LateFeesPreviewOut {
  const r = rec(json, "late fees");
  return {
    as_of: day(r.as_of, "as_of"),
    count: int(r.count, "count", 0, 1_000_000),
    total_paise: paise(r.total_paise, "total_paise"),
    rows: list(r.rows, "rows", 200).map((x) => { const y = rec(x, "late fee"); return { student_id: uuid(y.student_id, "student_id"), charge_id: uuid(y.charge_id, "charge_id"), amount_paise: paise(y.amount_paise, "amount_paise"), days_late: int(y.days_late, "days_late", 0, 100_000) }; }),
  };
}
export function parseLateFeesPosted(json: unknown): LateFeesPostedOut {
  const r = rec(json, "posted late fees");
  return { as_of: day(r.as_of, "as_of"), posted: int(r.posted, "posted", 0, 1_000_000), total_paise: paise(r.total_paise, "total_paise") };
}
export function parseAudienceAdded(json: unknown): AudienceAddedOut {
  const r = rec(json, "audience");
  return { added: int(r.added, "added", 0, 5000), skipped: list(r.skipped, "skipped", 5000).map((s) => rec(s, "skipped")), recipients: int(r.recipients, "recipients", 0, 5000) };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ requests
const tenant = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/institution/${tail}`;
};
const idOf = (id: string) => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};
const send = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const query = (pairs: Record<string, string | number | boolean | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(pairs)) if (v !== null && v !== undefined && v !== false) q.set(k, String(v));
  return q.size > 0 ? `?${q.toString()}` : "";
};

export async function getInstitutionProfile(accessToken: string, tenantId: string) {
  return parseProfile(await apiRequest(tenant(tenantId, "profile"), accessToken));
}
export type ProfileInput = { institutionType: (typeof INSTITUTION_TYPES)[number]; yearStartMonth: number; terms: readonly { label: string; start_month: number; end_month: number }[]; parentLanguages: readonly (typeof PARENT_LANGUAGES)[number][]; retentionMonths?: number | null };
/** The retention months are the Owner's, with the second factor; saving WITHOUT them switches the rule off, so the form always sends what it shows. */
export async function putInstitutionProfile(accessToken: string, tenantId: string, p: ProfileInput) {
  const body: Record<string, unknown> = { institution_type: p.institutionType, year_start_month: p.yearStartMonth, terms: p.terms, parent_languages: p.parentLanguages };
  if (p.retentionMonths !== undefined && p.retentionMonths !== null) body.student_retention_months = p.retentionMonths;
  return parseProfile(await apiRequest(tenant(tenantId, "profile"), accessToken, send("PUT", body)));
}

export async function listProgrammes(accessToken: string, tenantId: string, opts: { includeInactive?: boolean } = {}) {
  return parseProgrammes(await apiRequest(tenant(tenantId, `programmes${query({ include_inactive: opts.includeInactive })}`), accessToken));
}
export async function putProgramme(accessToken: string, tenantId: string, id: string, p: { name: string; kind: (typeof PROGRAMME_KINDS)[number]; groupKind: (typeof GROUP_KINDS)[number]; active: boolean }) {
  return parseProgrammeSaved(await apiRequest(tenant(tenantId, `programmes/${idOf(id)}`), accessToken, send("PUT", { name: p.name, kind: p.kind, group_kind: p.groupKind, active: p.active })));
}
export async function putGroup(accessToken: string, tenantId: string, programmeId: string, id: string, g: { label: string; timing: string | null; active: boolean }) {
  return parseGroupSaved(await apiRequest(tenant(tenantId, `programmes/${idOf(programmeId)}/groups/${idOf(id)}`), accessToken, send("PUT", { label: g.label, timing: g.timing, active: g.active })));
}

export async function listStudents(accessToken: string, tenantId: string, opts: { programmeId?: string; groupId?: string; status?: "active" | "left"; contactId?: string; after?: string | null; limit?: number } = {}) {
  return parseStudentList(await apiRequest(tenant(tenantId, `students${query({ programme_id: opts.programmeId && idOf(opts.programmeId), group_id: opts.groupId && idOf(opts.groupId), status: opts.status, contact_id: opts.contactId && idOf(opts.contactId), after: opts.after, limit: opts.limit ?? 50 })}`), accessToken));
}
export async function getStudent(accessToken: string, tenantId: string, id: string) {
  return parseStudent(await apiRequest(tenant(tenantId, `students/${idOf(id)}`), accessToken));
}
export type StudentInput = { contactId: string; isAdult: boolean; childLabel: string | null; programmeId: string; groupId: string | null; admissionNo: string | null; guardianContactId: string | null; joinedOn: string | null };
export async function putStudent(accessToken: string, tenantId: string, id: string, s: StudentInput) {
  const body: Record<string, unknown> = { contact_id: idOf(s.contactId), is_adult: s.isAdult, programme_id: idOf(s.programmeId) };
  if (s.childLabel) body.child_label = s.childLabel;
  if (s.groupId) body.group_id = idOf(s.groupId);
  if (s.admissionNo) body.admission_no = s.admissionNo;
  if (s.guardianContactId) body.guardian_contact_id = idOf(s.guardianContactId);
  if (s.joinedOn) body.joined_on = s.joinedOn;
  return parseStudentSaved(await apiRequest(tenant(tenantId, `students/${idOf(id)}`), accessToken, send("PUT", body)));
}
export async function setStudentStatus(accessToken: string, tenantId: string, id: string, status: "active" | "left", leftOn: string | null) {
  return parseStudent(await apiRequest(tenant(tenantId, `students/${idOf(id)}/status`), accessToken, send("POST", { status, ...(leftOn ? { left_on: leftOn } : {}) })));
}
/** The Owner, with the second factor: the label and number go; the row and the money records stay. */
export async function eraseStudent(accessToken: string, tenantId: string, id: string) {
  const r = rec(await apiRequest(tenant(tenantId, `students/${idOf(id)}/erase`), accessToken, send("POST")), "erased");
  return { erased: bool(r.erased, "erased"), replayed: r.replayed === true };
}

export async function listAdmissions(accessToken: string, tenantId: string, opts: { stage?: Stage; programmeId?: string; source?: Source; after?: string | null; limit?: number } = {}) {
  return parseAdmissionList(await apiRequest(tenant(tenantId, `admissions${query({ stage: opts.stage, programme_id: opts.programmeId && idOf(opts.programmeId), source: opts.source, after: opts.after, limit: opts.limit ?? 100 })}`), accessToken));
}
export async function getAdmission(accessToken: string, tenantId: string, id: string) {
  return parseAdmissionDetail(await apiRequest(tenant(tenantId, `admissions/${idOf(id)}`), accessToken));
}
export type AdmissionInput = { source: Source; programmeId: string | null; contactId: string | null; guardianName: string | null; guardianPhone: string | null };
export async function putAdmission(accessToken: string, tenantId: string, id: string, a: AdmissionInput) {
  const body: Record<string, unknown> = { source: a.source };
  if (a.programmeId) body.programme_id = idOf(a.programmeId);
  if (a.contactId) body.contact_id = idOf(a.contactId);
  if (a.guardianName) body.guardian_name = a.guardianName;
  if (a.guardianPhone) body.guardian_phone = a.guardianPhone;
  return parseAdmissionCreated(await apiRequest(tenant(tenantId, `admissions/${idOf(id)}`), accessToken, send("PUT", body)));
}
export async function setAdmissionStage(accessToken: string, tenantId: string, id: string, stage: "enquiry" | "campus_visit" | "application" | "lost", lostReason: LostReason | null) {
  return parseStageChanged(await apiRequest(tenant(tenantId, `admissions/${idOf(id)}/stage`), accessToken, send("POST", { stage, ...(lostReason ? { lost_reason: lostReason } : {}) })));
}
export type AdmitInput = { studentId: string; isAdult: boolean; childLabel: string | null; programmeId: string; groupId: string | null; admissionNo: string | null; planId: string | null; assignmentId: string | null; joinedOn: string | null };
export async function admit(accessToken: string, tenantId: string, id: string, a: AdmitInput) {
  const body: Record<string, unknown> = { student_id: idOf(a.studentId), is_adult: a.isAdult, programme_id: idOf(a.programmeId) };
  if (a.childLabel) body.child_label = a.childLabel;
  if (a.groupId) body.group_id = idOf(a.groupId);
  if (a.admissionNo) body.admission_no = a.admissionNo;
  if (a.planId && a.assignmentId) {
    body.plan_id = idOf(a.planId);
    body.assignment_id = idOf(a.assignmentId);
  }
  if (a.joinedOn) body.joined_on = a.joinedOn;
  return parseAdmitted(await apiRequest(tenant(tenantId, `admissions/${idOf(id)}/admit`), accessToken, send("POST", body)));
}

export async function listFeePlans(accessToken: string, tenantId: string, opts: { programmeId?: string; includeInactive?: boolean } = {}) {
  return parseFeePlanList(await apiRequest(tenant(tenantId, `fee-plans${query({ programme_id: opts.programmeId && idOf(opts.programmeId), include_inactive: opts.includeInactive })}`), accessToken));
}
export async function getFeePlan(accessToken: string, tenantId: string, id: string) {
  return parseFeePlan(await apiRequest(tenant(tenantId, `fee-plans/${idOf(id)}`), accessToken));
}
export type FeePlanInput = { name: string; programmeId: string; groupId: string | null; academicYear: string; lateKind: (typeof LATE_KINDS)[number]; latePaise: number | null; lateGraceDays: number; lateCapPaise: number | null; active: boolean; lines: readonly { head: Head; instalment_no: number; due_date: string; amount_paise: number }[] };
export async function putFeePlan(accessToken: string, tenantId: string, id: string, p: FeePlanInput) {
  const body: Record<string, unknown> = { name: p.name, programme_id: idOf(p.programmeId), academic_year: p.academicYear, late_fee_kind: p.lateKind, late_fee_grace_days: p.lateGraceDays, active: p.active, lines: p.lines };
  if (p.groupId) body.group_id = idOf(p.groupId);
  if (p.lateKind !== "none") {
    body.late_fee_paise = p.latePaise;
    if (p.lateCapPaise !== null) body.late_fee_cap_paise = p.lateCapPaise;
  }
  return parseFeePlan(await apiRequest(tenant(tenantId, `fee-plans/${idOf(id)}`), accessToken, send("PUT", body)));
}
export async function assignFeePlan(accessToken: string, tenantId: string, assignmentId: string, studentId: string, planId: string, assignedOn: string | null) {
  return parseAssigned(await apiRequest(tenant(tenantId, `fee-assignments/${idOf(assignmentId)}`), accessToken, send("PUT", { student_id: idOf(studentId), plan_id: idOf(planId), ...(assignedOn ? { assigned_on: assignedOn } : {}) })));
}
export async function voidFeeAssignment(accessToken: string, tenantId: string, assignmentId: string) {
  return parseAssignmentVoided(await apiRequest(tenant(tenantId, `fee-assignments/${idOf(assignmentId)}/void`), accessToken, send("POST")));
}

export async function getStudentFees(accessToken: string, tenantId: string, studentId: string, asOf?: string) {
  return parseFeeStatement(await apiRequest(tenant(tenantId, `students/${idOf(studentId)}/fees${query({ as_of: asOf })}`), accessToken));
}
export async function getStudentFeeEntries(accessToken: string, tenantId: string, studentId: string, limit = 100) {
  return parseFeeEntries(await apiRequest(tenant(tenantId, `students/${idOf(studentId)}/fees/entries${query({ limit })}`), accessToken));
}
export async function putFeePayment(accessToken: string, tenantId: string, studentId: string, entryId: string, p: { receivedOn: string; amountPaise: number; method: Method; againstEntryId: string | null }) {
  const r = rec(await apiRequest(tenant(tenantId, `students/${idOf(studentId)}/payments/${idOf(entryId)}`), accessToken, send("PUT", { received_on: p.receivedOn, amount_paise: p.amountPaise, method: p.method, ...(p.againstEntryId ? { against_entry_id: idOf(p.againstEntryId) } : {}) })), "payment");
  return { entry_id: uuid(r.entry_id, "entry_id"), receipt_no: optStr(r.receipt_no, "receipt_no", 40), replayed: r.replayed === true };
}
export async function putFeeConcession(accessToken: string, tenantId: string, studentId: string, entryId: string, c: { mode: "amount" | "percent"; value: number; reasonCode: (typeof CONCESSION_REASONS)[number]; reference: string | null }) {
  const r = rec(await apiRequest(tenant(tenantId, `students/${idOf(studentId)}/concessions/${idOf(entryId)}`), accessToken, send("PUT", { mode: c.mode, value: c.value, reason_code: c.reasonCode, ...(c.reference ? { reference: c.reference } : {}) })), "concession");
  return { entry_id: uuid(r.entry_id, "entry_id"), amount_paise: paise(r.amount_paise, "amount_paise"), replayed: r.replayed === true };
}
export async function putFeeAdjustment(accessToken: string, tenantId: string, studentId: string, entryId: string, a: { direction: "debit" | "credit"; amountPaise: number; reasonCode: (typeof ADJUSTMENT_REASONS)[number]; dueDate: string | null; reference: string | null }) {
  const r = rec(await apiRequest(tenant(tenantId, `students/${idOf(studentId)}/adjustments/${idOf(entryId)}`), accessToken, send("PUT", { direction: a.direction, amount_paise: a.amountPaise, reason_code: a.reasonCode, ...(a.dueDate ? { due_date: a.dueDate } : {}), ...(a.reference ? { reference: a.reference } : {}) })), "adjustment");
  return { entry_id: uuid(r.entry_id, "entry_id"), replayed: r.replayed === true };
}
export async function getFeeReceipt(accessToken: string, tenantId: string, entryId: string) {
  return parseFeeReceipt(await apiRequest(tenant(tenantId, `receipts/${idOf(entryId)}`), accessToken));
}
export async function getGuardianFees(accessToken: string, tenantId: string, contactId: string, asOf?: string) {
  return parseGuardianFees(await apiRequest(tenant(tenantId, `guardians/${idOf(contactId)}/fees${query({ as_of: asOf })}`), accessToken));
}
export async function getLateFeesPreview(accessToken: string, tenantId: string) {
  return parseLateFeesPreview(await apiRequest(tenant(tenantId, "late-fees"), accessToken));
}
export async function postLateFees(accessToken: string, tenantId: string) {
  return parseLateFeesPosted(await apiRequest(tenant(tenantId, "late-fees/post"), accessToken, send("POST")));
}
export async function listPending(accessToken: string, tenantId: string, opts: { asOf?: string; programmeId?: string; groupId?: string; after?: string | null; limit?: number } = {}) {
  return parsePending(await apiRequest(tenant(tenantId, `fees/pending${query({ as_of: opts.asOf, programme_id: opts.programmeId && idOf(opts.programmeId), group_id: opts.groupId && idOf(opts.groupId), after: opts.after, limit: opts.limit ?? 50 })}`), accessToken));
}

export type AudienceScope = { scope: "all" } | { scope: "programme"; programmeId: string } | { scope: "group"; groupId: string };
/** `PUT /announcements/{campaign}/audience`: one message per guardian however many children; the day is the date each person's steps count from. */
export async function putAnnouncementAudience(accessToken: string, tenantId: string, campaignId: string, a: AudienceScope & { date: string }) {
  const body: Record<string, unknown> = { scope: a.scope, date: a.date };
  if (a.scope === "programme") body.programme_id = idOf(a.programmeId);
  if (a.scope === "group") body.group_id = idOf(a.groupId);
  return parseAudienceAdded(await apiRequest(tenant(tenantId, `announcements/${idOf(campaignId)}/audience`), accessToken, send("PUT", body)));
}
