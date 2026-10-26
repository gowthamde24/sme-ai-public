# ADR 0096: marks messages to guardians without storing marks (job DP, part 2)

Status: accepted by the owner's decision of 26 Oct 2026 ("the platform never stores children's marks"); built on branch `api/dp-marks-send`.

## Context
A school wants to tell guardians a child's marks on WhatsApp. Marks are children's data, the most protected data we could hold (DPDP; ADR 0084 part 5). The words name the child, so a model must never write, rewrite or read them (job DM: fixed templates in `app/education/progress.py`).

## Decision
1. **No marks table, no file store.** The marks file is uploaded in the request body (as every spreadsheet import), parsed in memory with the shared defensive reader, and dropped when the request ends. A preview and a send are two requests; the second carries the same file again, with the file's SHA-256 and the count the Owner saw. A different file or count is refused (409) and nothing is sent. Because nothing is held between the two, there is nothing to delete on cancel and nothing to expire after 24 hours.
2. **A send log is all that stays** (`public.marks_send_log`): batch, line number, guardian contact, template id (`marks.te`), status, a closed reason, who approved, times. The table has no column that could hold a mark, a name, a subject, a term or a message (a pgTAP test lists the columns). Rows are append-only; a `pending` row can only become `sent` or `failed`.
3. **The Owner approves, with a second factor.** The database enforces it (`marks_send_begin`), not only the API. An Admin can preview.
4. **School only**, twice: the table is guarded by the `programmes` module (SM701), and every function says SM701 for any other business.
5. **Blocked guardians are never written to** (opted out, consent withdrawn, erased): the log says `blocked`.
6. **A retry never sends a line twice**: the client's `batch_id` plus the file's line number is the log's unique key; lines already logged are counted as `already_handled` and not sent.
7. **No AI path**: the module imports nothing that talks to a model, a speech engine or the network; no module of the assistant, agents, voice, follow-ups, outbox, WhatsApp or scheduler imports it; the assistant has no tool for it (tests read the imports and the tool names). The sender receives the finished text and the contact id; the only sender is a fake.

## Consequences
- The screen holds the file in browser memory between preview and send (about 3 MB at most).
- A real, asynchronous sender (a worker sending thousands of messages over minutes) would need the words to exist somewhere until delivered; that is a separate decision (a short-lived, encrypted hold) and is NOT built. The interface (`GuardianSender`) and the log do not change.
- A guardian is found by phone number among the school's contacts; a number nobody holds is reported, never created.
