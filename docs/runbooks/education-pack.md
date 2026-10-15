# Runbook: the education pack (job CR, ADR 0087)

For the owner or the support person setting up a school, a college or a coaching centre, and for the next developer. Everything here is local and uses **synthetic** data (every number is a `+00 ...` number). **No real student may be entered before the DPDP children's review** (`docs/pre-pilot-checklist.md`, "Education core"): the real-data gate for a workspace that keeps students opens only with a review reference that begins `dpdp-children:`.

## 1. Set up the institution (Owner or Admin)

1. `PUT /v1/tenants/{t}/institution/profile`: the type (school, junior college, degree college, university, coaching, training), the month the academic year starts, up to six terms, the languages parents use. The Owner, with a second factor, may also set `student_retention_months` (a student who left that long ago is erased by the worker; leave it out for "never automatically": saving the profile **without** the months switches the rule off, and only the Owner may do that).
2. `PUT .../programmes/{id}`: a class set ("Class 5", `kind: class`) or a course ("B.Com", `kind: course`), and what it is divided into (`group_kind`: `section`, `year`, `semester`, `batch`, `none`). `PUT .../programmes/{id}/groups/{gid}`: the sections/years/batches (a batch may have a `timing`). Nothing is deleted: make it inactive.
3. Students: either one by one (`PUT .../students/{id}`) or the **students file** (section 4).

## 2. The child's record is the minimum

A student is the adult we write to (`contact_id`: the guardian, or the adult student themself with `is_adult: true` and no label), a `child_label` (a first name or initials, up to 30 characters, **no digits**), the class and section, an optional school admission number. **Nothing else is accepted**: not a date of birth, a photograph, an address, an identity number, health, religion, caste, income, marks, attendance, behaviour, a note, a phone number, an e-mail address or a handle (the API answers 422; the database has no column). A child is never a contact. Only Owner, Admin and Sales read a student; a Viewer sees none. Owner and Admin write.

* **Leaving:** `POST .../students/{id}/status` `{"status": "left", "left_on": "2026-09-30"}`. The retention clock runs from that day.
* **Erasing one child on request:** `POST .../students/{id}/erase` (Owner, second factor). The label and number go; the row and the money records stay. **Erasing a guardian** (the privacy workflow) erases their children too.

## 3. Admissions (Owner, Admin, Sales)

1. **A new enquiry:** `PUT .../admissions/{id}` with the source (WhatsApp, walk-in, website, ad, referral, other), the programme asked about (optional) and either an existing contact or a new guardian's `guardian_name` and `guardian_phone`. No child is stored yet.
2. **Move it:** `POST .../admissions/{id}/stage` `{"stage": "campus_visit" | "application" | "lost" ...}` (`lost` needs a reason: fees, distance, other school, not interested, no response, other). It only moves forward; an Owner or Admin may re-open a lost one. **A campus visit** is an ordinary visit (booking one for the guardian moves an enquiry still at `enquiry` to `campus_visit`).
3. **Admit:** `POST .../admissions/{id}/admit` (Owner, Admin) makes the student and, with `plan_id` and `assignment_id` together, assigns the fee plan, in one go: if anything is wrong nothing is made. An adult student: `is_adult: true`, no label.
4. The pipeline: `GET .../admissions?stage=&programme_id=&source=`; one enquiry with its history: `GET .../admissions/{id}`; the funnel: `GET .../reports/education.funnel`.

## 4. The students file (Owner or Admin)

The shared spreadsheet import with `kind=students` (CSV or Excel, up to 5,000 rows, in parts of 500): `POST /v1/tenants/{t}/imports/spreadsheet/inspect?kind=students` (suggests which column is which, in English; te, hi, kn, ta headers are a first draft), `.../preview?kind=students&job_id=` (a dry run: classes and sections the school does not have are `needs_review`; nothing is invented), `.../{job_id}/confirm` (second factor). A guardian is found by phone number or made, and gets their suppression keys. The preview and the result name **guardians, never a child**.

## 5. Fees

1. **A fee plan** (`PUT .../fee-plans/{id}`, Owner or Admin): a programme (and optionally one section), the academic year (`2026-27`), the lines (head: tuition, admission, transport, hostel, exam, books, other; instalment number; due date; amount in paise) and an optional late-fee rule (`fixed`, or `per_day` with a grace and a cap). **A plan a student has been assigned cannot change**: make a new one.
2. **Assign** (`PUT .../fee-assignments/{id}`): each instalment becomes a charge on that student's own ledger. One live plan per student per year. A mistake: `POST .../fee-assignments/{id}/void` (the charges are voided).
3. **Take a payment** (`PUT .../students/{sid}/payments/{entry}`, Owner/Admin/Sales): the receipt number (`R/2026-27/000001`) is in the answer; `GET .../receipts/{entry}` gives the receipt as data. Credits go to the **oldest claim first**, per child.
4. **Concession** (`PUT .../students/{sid}/concessions/{entry}`, Owner/Admin, second factor): an amount or a percentage of what was charged to that child, with a reason code (scholarship, sibling, staff ward, hardship, merit, other); the database never lets concessions exceed what was charged. **Adjustment** (`.../adjustments/{entry}`): a correction up (with a due date) or down. A void is `POST /v1/tenants/{t}/ledger/entries/{entry}/void` (the shared ledger's).
5. **Late fees:** `GET .../late-fees` shows what the plans' rules give today (nothing is added by looking); `POST .../late-fees/post` (Owner/Admin, second factor) posts them, each against its instalment. Posting twice adds nothing twice.
6. **Read:** `GET .../students/{sid}/fees` (statement, ageing since the entry and past the due date), `.../fees/entries`, `GET .../guardians/{contact}/fees` (what a guardian owes across their children), `GET .../fees/pending` (the pending list, largest first).

## 6. Messages to parents

* **A fee reminder:** a campaign of kind `fee_due` (`PUT /v1/tenants/{t}/campaigns/{id}`) whose list is built **from the ledger** with `{"due_from", "due_to", "party": "student"}`: a guardian of several children is ONE person, with the total of the claims in the range. The text may use `{{name}}` (the guardian), `{{amount}}`, `{{due_date}}`, `{{reference}}` and `{{business}}`; it can never name a child. The Owner approves the whole campaign once, with a second factor, after the rendered samples (`docs/runbooks/campaigns-and-ledger.md`).
* **An announcement:** a campaign of kind `event`, `exam` or `holiday` (no amount), then `PUT .../announcements/{campaign}/audience` `{"scope": "all" | "programme" | "group", "programme_id"/"group_id", "date"}`: one message per guardian however many children. Approval, results and the call list are the same as for any campaign.

## 7. Reports (`GET .../reports/{code}?from=&to=`)

`education.collection` (due, pending, collected, conceded, collection percent, by programme and by class/section, by day), `education.today` (today's receipts by method), `education.pending` (the word is "pending"), `education.funnel` (enquiries to admitted, by source, programme and lost reason). All figures are sums of entries; the shape is the one every pack's reports use.

## 8. What you see when something is refused

| You see | It means |
|---|---|
| 403 `module_off` | the business is not on the education pack |
| 403 `mfa_required` | a second factor is needed (retention months, a concession, an adjustment, posting late fees, erasing one child, confirming an import) |
| 409 `admission_no_used` | that admission number is another student's (the answer never says whose) |
| 409 `admission_stage` | the enquiry cannot move that way (back, or from admitted/lost) |
| 409 `fee_plan_in_use` | a student has the plan: make a new one |
| 409 `fee_plan_exists` | the student already has a plan for that year |
| 409 `student_not_active` | the student left or was erased |
| 422 | a field outside the minimum, a label with a digit, a missing day for a student who left... |

## 9. For the developer

* The migrations are `20261125090000` to `20261125090300`; pgTAP 104 to 107; `services/ai-api/tests/test_cr_*.py`; `tests/integration/test_cr_education.py` (a canary label through every path).
* **A new place that reads a child must be a decision**: `tests/test_cr_child_fields.py` fails if any module outside the doors names a child column or the education repository.
* The education tables change only through their functions (the door `app.edu_edit`); the erasure and the retention clean-up pass through their own door. Do not add a DELETE or a column for anything on the list in section 2.
