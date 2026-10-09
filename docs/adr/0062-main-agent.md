# ADR 0062: The Main agent (assistant), backend

Status: built locally (job AG, 2026-10-09); switched OFF by default; nothing deployed, nothing pushed. Related: ADR 0013 (agent runtime), 0014 (erasure), 0019 (quotes), 0022 (follow-up), 0061 (open sign-up).

## Context
The owner of a business needs one place to ask "what is waiting?" and "what did Harbour Retail order?", in the language they write in, with proof for every answer, and to
have routine writing done for them. It must not become a hidden autonomous actor (CLAUDE.md non-negotiables 3, 4, 6).

## Decision
1. **It is an agent run like the others.** One message = one run of the `assistant` agent on a new run target, `conversation_id`. The runtime's closed loop, the platform kill switch,
   the per-agent flag (`assistant_enabled`), the per-business switch, `allowed_tenants`, the run limits and the daily cost cap (Asia/Kolkata day, job AF) all apply. Off by default
   at every layer; the operator enables one business locally with `select app.operator_enable_assistant('<slug>')` (runbook `docs/runbooks/main-agent-local.md`).
2. **Read tools only over existing reads**, called with the caller's own token, so row-level security scopes every result to the caller's business: `get_today`, `list_quotes`,
   `list_orders`, `find_customers`, `list_enquiries`, `find_price`, `list_followups`. No generic SQL, no tenant argument (a closed schema refuses any extra field).
3. **Action tools make DRAFTS only**: `draft_quote` (through the quote engine; the model gives no price and the schema has no price field), `draft_followup` (through the follow-up
   service, with its suppression and cadence gates), `draft_reply` (a customer reply in the customer's language plus an English gloss, always marked machine text, no price in it,
   checked again by the database), `record_enquiry`. Each returns a draft id and a card telling where to approve. There is no send, approve, price, delete or payment tool. At most
   4 action calls per run. Approval stays where it is today.
4. **Sources are checked by code.** The model cites handles of tool results; the code keeps only handles that exist in this run, turns them into `{type, id, label, open}` read
   fresh, and refuses an answer with no real source (one repair round, then a fixed "I could not find that" sentence). Every rupee amount in an answer must be one a tool returned.
5. **Language.** The reply language is detected from the owner's message by script (word share), and the reply is checked against it (letter share); a mismatch is repaired once,
   then replaced by a fixed phrase in the right language.
6. **Injection.** Record content (customer names, enquiry text, notes, earlier chat lines) goes only in per-run-delimited DATA blocks flagged untrusted, flattened to single lines; the
   system block is a constant. The only thing treated as a request is the owner's current line. Notes that flow back to the model are a closed list of fixed sentences.
7. **Storage.** `assistant_conversations`, `assistant_messages`, `assistant_reply_drafts`: tenant-owned, row-level security forced, **private to the person who started the chat**
   (and only for Owner, Admin and Sales). No client write grant at all; SECURITY DEFINER functions (`assistant_begin_message`, `assistant_save_reply`,
   `assistant_save_reply_draft`) check the caller, the switches, the run and the content. A message id is idempotent: the same words replay the stored answer and spend nothing; other
   words under the same id are refused (`message_id_used`). Sources are stored as `{type, id}` pairs only (no names); labels are read fresh, so an erased record reads "(no longer
   available)". Message and reply-draft text is registered with the erasure flow (tenant scope and sweep); customer names found in text go to the "needs manual review" list.
8. **API.** `POST /v1/tenants/{id}/assistant/messages` streams server-sent events (`start`, `step`, `delta`, `sources`, `drafts`, `done` / `error`); `GET .../assistant/conversations/{id}`
   reads a chat back. The model call is **not** token-streamed (the model interface returns whole results); the finished answer is sent in pieces.
9. **Status.** `GET /agents/status` reports `switched_off` for an agent that exists but whose switch is off, distinct from `not_available` (it does not exist).

## Consequences and limits
- The real Anthropic adapter has not run live for this agent (`make eval-live` is the owner's opt-in step). The local development model is scripted and obeys nothing from data.
- Conversation text can contain personal data typed by the owner. It is erasable (registry rows) but only matched by exact e-mail and phone; names need manual review.
- A chat is limited to 200 messages; a failed message is re-sent as a new message id.
- Evals (30 cases: 10 English, 10 Telugu, 10 mixed) run in `make eval` against the real local stack with a scripted model; they test the code's containment, not the model's quality.
