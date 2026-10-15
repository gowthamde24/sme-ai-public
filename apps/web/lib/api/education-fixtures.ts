/** Synthetic education answers as the API sends them (job CS). Nothing here is a real child, guardian, number or amount: every child is a first name or initials of an invented family. */
export const PROGRAMME = "bb000000-0000-4000-8000-000000000001";
export const PROGRAMME2 = "bb000000-0000-4000-8000-000000000002";
export const GROUP = "bb100000-0000-4000-8000-000000000001";
export const GROUP2 = "bb100000-0000-4000-8000-000000000002";
export const STUDENT = "5d000000-0000-4000-8000-000000000001";
export const STUDENT2 = "5d000000-0000-4000-8000-000000000002";
export const GUARDIAN = "22222222-2222-4222-8222-2222222222aa";
export const PLAN = "fa000000-0000-4000-8000-000000000001";
export const ASSIGNMENT = "fa100000-0000-4000-8000-000000000001";
export const ADMISSION = "ad000000-0000-4000-8000-000000000001";
export const ADMISSION2 = "ad000000-0000-4000-8000-000000000002";
export const FEE_PAYMENT = "ee000000-0000-4000-8000-0000000000f1";
export const FEE_CHARGE = "ee000000-0000-4000-8000-0000000000f2";

export const PROFILE_JSON = {
  configured: true, institution_type: "school", year_start_month: 6, terms: [{ label: "Term 1", start_month: 6, end_month: 9 }, { label: "Term 2", start_month: 10, end_month: 3 }], parent_languages: ["en", "te"], student_retention_months: null, updated_at: "2026-10-01T05:00:00+00:00",
};
export const PROFILE_NONE_JSON = { configured: false };
export const PROGRAMMES_JSON = {
  items: [
    { id: PROGRAMME, name: "Class 5 (synthetic)", kind: "class", group_kind: "section", active: true, students: 31, groups: [{ id: GROUP, label: "A", timing: null, active: true, students: 16 }, { id: GROUP2, label: "B", timing: null, active: true, students: 15 }] },
    { id: PROGRAMME2, name: "B.Com (synthetic)", kind: "course", group_kind: "year", active: true, students: 0, groups: [] },
  ],
};
export const PROGRAMME_SAVED_JSON = { id: PROGRAMME, name: "Class 5 (synthetic)", kind: "class", group_kind: "section", active: true, created: true };
export const GROUP_SAVED_JSON = { id: GROUP, programme_id: PROGRAMME, label: "A", timing: null, active: true, created: true };

export const STUDENT_JSON = {
  id: STUDENT, contact_id: GUARDIAN, is_adult: false, display_name: "Asha (synthetic)", contact_name: "Ravi Kumar (synthetic)", guardian_contact_id: null, programme_id: PROGRAMME, group_id: GROUP, programme_name: "Class 5 (synthetic)", group_label: "A",
  admission_no: "A-1001", status: "active", joined_on: "2026-06-10", left_on: null, erased: false, created_at: "2026-06-10T05:00:00+00:00", updated_at: "2026-06-10T05:00:00+00:00",
};
export const STUDENT2_JSON = { ...STUDENT_JSON, id: STUDENT2, display_name: "Kiran (synthetic)", admission_no: null, group_id: GROUP2, group_label: "B" };
export const STUDENT_LEFT_JSON = { ...STUDENT2_JSON, status: "left", left_on: "2026-09-30" };
export const STUDENT_ERASED_JSON = { ...STUDENT2_JSON, display_name: null, admission_no: null, erased: true };
export const STUDENT_LIST_JSON = { items: [STUDENT_JSON, STUDENT2_JSON], next_cursor: null };
export const STUDENT_SAVED_JSON = { ...STUDENT_JSON, created: true };

const admission = (over: object) => ({ id: ADMISSION, lead_id: "1ead0000-0000-4000-8000-000000000001", contact_id: GUARDIAN, contact_name: "Ravi Kumar (synthetic)", programme_id: PROGRAMME, programme_name: "Class 5 (synthetic)", source: "whatsapp", stage: "enquiry", lost_reason: null, student_id: null, stage_at: "2026-10-10T05:00:00+00:00", created_at: "2026-10-08T05:00:00+00:00", visits: 0, next_visit: null, ...over });
export const ADMISSION_JSON = admission({});
export const ADMISSIONS_JSON = {
  items: [
    ADMISSION_JSON,
    admission({ id: ADMISSION2, contact_name: "Lakshmi Devi (synthetic)", source: "walk_in", stage: "campus_visit", visits: 1, next_visit: "2026-10-18T05:00:00+00:00" }),
    admission({ id: "ad000000-0000-4000-8000-000000000003", contact_name: "Suresh Babu (synthetic)", source: "referral", stage: "application" }),
    admission({ id: "ad000000-0000-4000-8000-000000000004", contact_name: "Meena (synthetic)", stage: "admitted", student_id: STUDENT }),
    admission({ id: "ad000000-0000-4000-8000-000000000005", contact_name: "Anil (synthetic)", source: "ad", stage: "lost", lost_reason: "fees" }),
  ],
  next_cursor: null,
};
export const ADMISSION_DETAIL_JSON = { ...ADMISSION_JSON, stage: "campus_visit", visits: 1, events: [{ stage: "enquiry", lost_reason: null, at: "2026-10-08T05:00:00+00:00" }, { stage: "campus_visit", lost_reason: null, at: "2026-10-10T05:00:00+00:00" }] };
export const ADMISSION_CREATED_JSON = { ...ADMISSION_JSON, created: true };
export const STAGE_CHANGED_JSON = { ...ADMISSION_JSON, stage: "application", replayed: false };
export const ADMITTED_JSON = { ...ADMISSION_JSON, stage: "admitted", student_id: STUDENT, replayed: false, student_created: true, fee_assignment: { assignment_id: ASSIGNMENT } };

const line = (n: number, due: string, amount: number, head = "tuition") => ({ head, instalment_no: n, due_date: due, amount_paise: amount });
export const PLAN_JSON = {
  id: PLAN, name: "Class 5 fees 2026-27 (synthetic)", programme_id: PROGRAMME, group_id: null, academic_year: "2026-27", late_fee_kind: "fixed", late_fee_paise: 20000, late_fee_grace_days: 5, late_fee_cap_paise: null, active: true,
  created_at: "2026-05-20T05:00:00+00:00", total_paise: 6200000, assigned: 31,
};
export const PLAN_LIST_JSON = { items: [PLAN_JSON, { ...PLAN_JSON, id: "fa000000-0000-4000-8000-000000000002", name: "B.Com year 1 (synthetic)", programme_id: PROGRAMME2, late_fee_kind: "none", late_fee_paise: null, late_fee_grace_days: 0, total_paise: 4500000, assigned: 0 }] };
export const PLAN_DETAIL_JSON = { ...PLAN_JSON, lines: [line(1, "2026-06-15", 2500000), line(2, "2026-10-15", 1500000), line(3, "2027-01-15", 1500000), line(1, "2026-06-15", 700000, "transport")] };

const fee = (over: object) => ({ id: FEE_CHARGE, kind: "charge", direction: "debit", amount_paise: 2500000, entry_date: "2026-06-10", due_date: "2026-06-15", reference: "Tuition 1", method: null, reason_code: null, receipt_no: null, against_entry_id: null, source: "manual", voided: false, ...over });
export const FEE_ENTRIES_JSON = {
  account_id: "acacacac-acac-4cac-8cac-acacacacacac",
  entries: [
    fee({ id: FEE_PAYMENT, kind: "payment", direction: "credit", amount_paise: 2500000, entry_date: "2026-06-12", due_date: null, reference: null, method: "upi", receipt_no: "R/2026-27/000003" }),
    fee({}),
    fee({ id: "ee000000-0000-4000-8000-0000000000f3", amount_paise: 1500000, entry_date: "2026-06-10", due_date: "2026-10-15", reference: "Tuition 2" }),
    fee({ id: "ee000000-0000-4000-8000-0000000000f4", kind: "concession", direction: "credit", amount_paise: 200000, entry_date: "2026-07-01", due_date: null, reference: null, reason_code: "sibling" }),
  ],
};
export const FEE_STATEMENT_JSON = {
  student: STUDENT_JSON,
  assignment: { id: ASSIGNMENT, plan_id: PLAN, academic_year: "2026-27", assigned_on: "2026-06-10", plan_name: "Class 5 fees 2026-27 (synthetic)" },
  statement: {
    student_id: STUDENT, account_id: "acacacac-acac-4cac-8cac-acacacacacac", company_id: null, contact_id: null, as_of: "2026-10-14", invoiced_paise: 4000000, paid_paise: 2700000, payments_paise: 2500000, concessions_paise: 200000, adjustments_paise: 0,
    outstanding_paise: 1300000, credit_paise: 0, overdue_paise: 0, ageing: { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 1300000 }, overdue_ageing: { not_due: 1300000, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
    open_invoices: [{ invoice_id: "ee000000-0000-4000-8000-0000000000f3", entry_id: "ee000000-0000-4000-8000-0000000000f3", kind: "charge", invoice_no: null, reference: "Tuition 2", invoice_date: "2026-06-10", due_date: "2026-10-15", amount_paise: 1500000, open_paise: 1300000, age_days: 126, overdue_days: 0 }],
    credit_limit_paise: null, over_limit: false,
  },
};
export const FEE_RECEIPT_JSON = {
  receipt_no: "R/2026-27/000003", received_on: "2026-06-12", amount_paise: 2500000, method: "upi", voided: false, business_name: "Greenfield School (synthetic)", paid_by: "Ravi Kumar (synthetic)", student: STUDENT_JSON, against: "Tuition 1", balance_after_paise: 1500000, recorded_at: "2026-06-12T06:00:00+00:00",
};
export const GUARDIAN_FEES_JSON = { contact_id: GUARDIAN, as_of: "2026-10-14", students: [{ student_id: STUDENT, display_name: "Asha (synthetic)", outstanding_paise: 1300000, overdue_paise: 0 }, { student_id: STUDENT2, display_name: "Kiran (synthetic)", outstanding_paise: 2400000, overdue_paise: 900000 }], outstanding_paise: 3700000, overdue_paise: 900000 };
export const PENDING_JSON = {
  items: [
    { student_id: STUDENT2, display_name: "Kiran (synthetic)", programme_name: "Class 5 (synthetic)", group_label: "B", contact_id: GUARDIAN, contact_name: "Ravi Kumar (synthetic)", pending_paise: 900000, due_paise: 2400000, overdue_days: 12 },
    { student_id: STUDENT, display_name: "Asha (synthetic)", programme_name: "Class 5 (synthetic)", group_label: "A", contact_id: GUARDIAN, contact_name: "Ravi Kumar (synthetic)", pending_paise: 400000, due_paise: 2500000, overdue_days: 3 },
  ],
  next_cursor: "p:400000:5d000000-0000-4000-8000-000000000001",
};
export const LATE_FEES_JSON = { as_of: "2026-10-14", count: 2, total_paise: 40000, rows: [{ student_id: STUDENT2, charge_id: FEE_CHARGE, amount_paise: 20000, days_late: 7 }, { student_id: STUDENT, charge_id: "ee000000-0000-4000-8000-0000000000f3", amount_paise: 20000, days_late: 2 }] };
export const LATE_FEES_POSTED_JSON = { as_of: "2026-10-14", posted: 2, total_paise: 40000 };
export const AUDIENCE_JSON = { added: 28, skipped: [{ row: 3, reason: "no_phone" }], recipients: 28 };

export const COLLECTION_REPORT_JSON = {
  report: "education.collection", as_of: "2026-10-14", from: "2026-06-01", to: "2026-10-14",
  kpis: [
    { key: "due_paise", value: 58000000, unit: "paise" }, { key: "pending_paise", value: 7400000, unit: "paise" }, { key: "collected_paise", value: 49000000, unit: "paise" }, { key: "concessions_paise", value: 1600000, unit: "paise" },
    { key: "collection_pct", value: 87.2, unit: "percent" }, { key: "students_pending", value: 9, unit: "count" },
  ],
  tables: [
    { key: "by_programme", columns: [{ key: "programme", type: "text" }, { key: "students", type: "count" }, { key: "due_paise", type: "paise" }, { key: "pending_paise", type: "paise" }, { key: "collection_pct", type: "percent" }], rows: [["Class 5 (synthetic)", 31, 58000000, 7400000, 87.2]] },
    { key: "by_group", columns: [{ key: "programme", type: "text" }, { key: "group", type: "text" }, { key: "students", type: "count" }, { key: "due_paise", type: "paise" }, { key: "pending_paise", type: "paise" }, { key: "collection_pct", type: "percent" }], rows: [["Class 5 (synthetic)", "A", 16, 30000000, 3000000, 90], ["Class 5 (synthetic)", "B", 15, 28000000, 4400000, 84.3]] },
  ],
  series: [{ key: "collection_by_day", points: [{ day: "2026-10-12", value: 2500000 }, { day: "2026-10-13", value: 1200000 }] }],
};
export const TODAY_REPORT_JSON = {
  report: "education.today", as_of: "2026-10-14", from: "2026-10-14", to: "2026-10-14",
  kpis: [{ key: "collected_paise", value: 3700000, unit: "paise" }, { key: "receipts", value: 4, unit: "count" }],
  tables: [{ key: "by_method", columns: [{ key: "method", type: "text" }, { key: "receipts", type: "count" }, { key: "amount_paise", type: "paise" }], rows: [["cash", 1, 700000], ["upi", 3, 3000000]] }],
  series: [],
};
export const FUNNEL_REPORT_JSON = {
  report: "education.funnel", as_of: "2026-10-14", from: "2026-07-17", to: "2026-10-14",
  kpis: [{ key: "enquiries", value: 40, unit: "count" }, { key: "campus_visits", value: 22, unit: "count" }, { key: "applications", value: 15, unit: "count" }, { key: "admitted", value: 11, unit: "count" }, { key: "lost", value: 9, unit: "count" }, { key: "conversion_pct", value: 27.5, unit: "percent" }],
  tables: [{ key: "by_source", columns: [{ key: "source", type: "text" }, { key: "enquiries", type: "count" }, { key: "admitted", type: "count" }], rows: [["whatsapp", 20, 6], ["walk_in", 12, 4]] }],
  series: [],
};
export const REPORT_CATALOGUE_JSON = { items: [{ code: "education.collection", title_key: "report.education.collection", window: "range", modules: ["reports", "programmes", "fees"] }, { code: "education.today", title_key: "report.education.today", window: "day", modules: ["reports", "programmes", "fees"] }] };
