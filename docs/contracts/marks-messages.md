# Marks and report messages to guardians: the API contract for the school's upload screen (job DP, part 2)

**Status: the shapes are final for the web; the endpoints are built on branch `api/dp-marks-send`.** Until they are on a deployed API, build against the example payloads (`packages/contracts/marks_messages.examples.json`, validated against the schema by a test).

Files (generated from `services/ai-api/app/marksmessages/models.py` by `make contracts`):
`packages/contracts/marks_messages.schema.json`, `marks_messages.ts`, `marks_messages.examples.json`.

## The rule (owner decision)
**The platform never stores a child's marks.** The school uploads a marks file for ONE send; the API reads it in memory for that request, fills the fixed, approved messages (the same text in `te`, `hi`, `kn`, `en`; drafts for native review), the Owner approves, it is sent (**sending is FAKE for now**), and the file is gone with the request. Only a **send log** stays: which guardian (a contact), when, which template id, what happened. No marks, no child's name, no subject, no term, no message text. **No AI reads the file or the words** (a test reads the imports).

**So the file is uploaded TWICE**, and the screen keeps it in the browser's memory in between: once to `preview`, once to `send` (together with the SHA-256 and the count the preview showed). Nothing is held on the server in between, so there is nothing to cancel and nothing to expire (the brief said "delete on cancel and after 24 h": there is no copy to delete). Closing the screen is the cancel.

## Endpoints (JSON answers; errors `{error: {code, message}}`)
Base: `/v1/tenants/{tenant_id}/institution/marks-messages`. A school only: any other business gets `403 module_off`.

| Method and path | Who | What |
|---|---|---|
| `GET /templates` | Owner, Admin | `TemplatesOut`: every fixed message with a sample (a made-up child), the file's columns and their accepted aliases, `max_rows` (5000), `max_bytes` (3 MB). Build the "what the message says" and "what the file must look like" parts from it. |
| `POST /preview?kind=&language=&term=` | Owner, Admin | **Body: the raw file** (CSV or XLSX; `Content-Type` does not matter; no multipart, the same as the spreadsheet imports). `kind` = `marks` or `report_ready`. `language` = the default for lines that name none (`en` default). `term` = the exam name when the file has no term column. Answer `PreviewOut` (below). Stores and sends nothing. |
| `POST /send?kind=&language=&term=&batch_id=&expect_sha256=&expect_count=` | **Owner, with a second factor** | **Body: the SAME file.** `batch_id` is a uuid the client makes once per send (a retry with it never sends a line twice). `expect_sha256` and `expect_count` are `file_sha256` and `will_send` from the preview the Owner approved. Answer `SendOut`. |
| `GET /batches?limit=&cursor=` | Owner, Admin | `BatchesOut`: the send log, one line per batch, newest first. |
| `GET /batches/{batch_id}` | Owner, Admin | `BatchOut`: the lines of a batch with the guardian's name (an adult), template id, status. |

### The file
First row = column names. Required for `marks`: `phone`, `student` (the child's first name or initials), `subject`, `marks`, `out_of`, and `term` (a column, or the `term` query value). Required for `report_ready`: `phone`, `student`, `term`. Optional: `language` (`en`/`te`/`hi`/`kn`) per line. Header words in English, Hindi, Telugu and Kannada are accepted (see `aliases`). A line whose phone is not a guardian of this school is **reported, never invented** (the school adds the parent first). Formula cells, over-long cells and files over 3 MB or 5,000 rows are refused with closed codes.

### PreviewOut
`rows` (lines read), `will_send`, `blocked` (guardians who opted out, withdrew WhatsApp consent or were erased), `unknown_guardian`, `invalid`, `duplicates`, `by_template` (`{"marks.te": 38, ...}`), `file_sha256`, `issues` (at most 50: `{line, code, field}`; `code` is `bad_phone` | `bad_value` | `bad_language` | `formula_cell` | `duplicate_row` | `unknown_guardian` | `blocked_guardian`; `field` names the column, **never a cell**), `issues_truncated`, and `example_text`: **the first ready message**, so the Owner can read the real words before approving. This is the one place a child's name and marks appear in an answer; show it to the Owner only, do not store it, log it or put it in a URL.

The approval screen: the counts, the issues, the example, then "Send [will_send] messages" (asks for the second factor). Show `blocked` and `unknown_guardian` plainly: those parents will not get a message.

### SendOut
`sent`, `failed`, `blocked`, `already_handled` (lines of this batch done earlier), `skipped` (lines that were not valid or had no guardian), `batch_id`, `file_kept` (always `false`; say it on the screen: "The file was not saved").

### Errors the screen should word
| status, code | when |
|---|---|
| 403 `module_off` | not a school |
| 403 `mfa_required` | `send` without a second factor |
| 409 `marks_file_changed` | the file sent is not the one previewed (SHA-256 differs). Nothing was sent: preview again |
| 409 `marks_count_changed` | the count moved since the preview (a guardian opted out). Nothing was sent: preview again |
| 413 `marks_file_too_large`; 422 `marks_file_empty`, `marks_file_not_utf8`, `marks_file_malformed_csv`, `marks_file_too_many_rows`, `marks_file_not_xlsx` ... | the file |
| 422 `marks_file_missing_column` | the message names the missing columns |
| 422 `marks_bad_request` / `invalid_id` | bad query values |
| 403 `workspace_read_only` | the plan ended (every send is a change) |

## Log statuses
`sent` | `blocked` (reason `suppressed` | `consent_withdrawn` | `erased`) | `failed` (reason `provider_refused` | `provider_unreachable`) | `pending` (a send in progress, or one that was interrupted: a retry with the same `batch_id` does not resend it; treat a `pending` row older than a few minutes as "unknown, ask the school to check").

## Sending is fake
The sender is the fake one: it sends nothing and the log says `sent`. A real sender (a WhatsApp template per kind and language, approved by Meta) is a later job; the API and these shapes will not change.
