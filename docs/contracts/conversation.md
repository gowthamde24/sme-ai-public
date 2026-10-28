# Contract: one conversation for the typed Ask box and the voice orb (C1 -> C2), job "conversational assistant" (28 Oct 2026)

Status: shapes are FINAL unless a line says "draft". Base: the API, all paths under `/v1/tenants/{tenant_id}`. Errors have the one shape `{error:{code,message,retry_after,request_id}}`. The API has no DELETE verb.
There is NO mode switch for the owner (no Ask / Do it): the client sends the words; THE ROUTER DECIDES what kind of turn it is and the reply says so.

## 1. The turn (text): POST /assistant/turns   (Owner, Admin, Sales)  -> server-sent events
Request (strict): `{ "message_id": uuid, "conversation_id": uuid|null, "text": 1..4000 chars, "language_hint": "te"|"en"|"hi"|"kn"|null }`
- `message_id` makes a retry safe (the same id replays the stored reply and spends nothing). `conversation_id: null` STARTS a new conversation (this is the "New conversation" button: just send the next message with null).
- The old `POST /assistant/messages` keeps working unchanged (written Ask, business data only). The new panel uses `/assistant/turns`.

Events, in order (event name = `type`):
| event | data | meaning |
|---|---|---|
| `intent` | `{kind: "smalltalk"\|"general"\|"business"\|"action"}` | what the router decided, FIRST (show nothing or a quiet hint); for debugging and the "looking at your records" state |
| `step` | `{step: "working"\|"looking"}` | a business or action turn is checking data (show a spinner line) |
| `text` | `{delta: str}` | the answer so far, in the owner's language; Markdown (lists, bold) |
| `source` | as Ask: `{kind, id, label, open: {type, id}}` | what a claim about THE BUSINESS rests on (only business turns have them) |
| `draft` | as Ask | a message draft the owner may edit and send |
| `confirm_action` | `{action_id, title, summary, steps: [str], count: int\|null, channel: "call"\|"whatsapp"\|"both"\|null, estimate: {messages, call_minutes, cost_paise}\|null, needs_second_factor: bool, expires_at}` | an ACTION is proposed: show the plan and ONE tap "Yes, do it" / "No" (section 3). Nothing has run. |
| `clarify` | `{question: str, action_id: uuid\|null}` | the router needs ONE short answer before it can plan or answer; the next message is the answer (send it normally; it continues the same conversation) |
| `done` | `{message_id, conversation_id, language, kind: "answer"\|"confirm_action"\|"clarify"}` | the turn ended; `kind` is the TYPED REPLY (exactly one per turn) |
| `error` | `{type:"error", code, message}` | as Ask (`budget` with plain words, `model_busy`, `agents_disabled`, ...) |

THE TYPED REPLY (`done.kind`): `answer` (text, maybe sources) | `confirm_action` (a plan waits for the owner) | `clarify` (one short question). A turn never ends without exactly one of these or an `error`.

What the router does (rules in code first, a small fast model second; never a client flag):
- `smalltalk` ("how are you", "I'm tired", jokes): warm, 1 to 2 sentences, no tools.
- `general` ("write a Diwali offer", "explain GST on sarees", "translate to Telugu", "how do I price paver blocks"): a real answer from general knowledge, no tools, no citations needed. Medical and legal: general information only, and says so.
- `business` ("how many enquiries today", "who didn't reply"): Ask's tool path with sources. The old rule "an uncited answer becomes a fixed refusal" is REPLACED: an uncited claim about the business's own data (numbers, customers, prices, stock, payments) is blocked and replaced by a plain "no record" sentence PLUS a helpful next step; general sentences pass. If there is no record the reply says so plainly and still helps ("No enquiries are recorded today. Want me to check the WhatsApp chats?").
- `action` ("call the new leads", "send the quote to Ramesh"): the tasks planner (`/tasks/plan`): either a plan (`confirm_action`) or one clarifying question (`clarify`).
- The owner's notes ("About my business", contract-context-sources.md) are used in every kind; a fact from the notes may be stated ("from your notes").
- Schools (Education pack): never discusses fees, marks or dues, never sends a child's details to a model; the router answers that part with the fixed refusal sentence of the school rules.
- The assistant's name is the owner-set name, else "your assistant". Language: the owner's (Telugu, English, Tenglish, Hindi, Kannada), mixed the way they mix.

## 2. History (storage per user per workspace; retention is in the privacy notice)
- `GET /assistant/conversations?limit=30&before=<iso>` -> `{items: [{id, title, updated_at, message_count, last_text}], next_before}`. The title is the first message cut to 60 characters (never an AI summary of private data). Only the caller's own conversations.
- `GET /assistant/conversations/{id}` (exists today) -> the messages, each `{id, role: "user"\|"assistant", text, language, sources, drafts, kind, action: {action_id, status: "proposed"\|"confirmed"\|"declined"\|"expired"\|"running"\|"done"}\|null, created_at}`.
- `POST /assistant/conversations/{id}/archive` -> 204 (hides it from the list; nothing is deleted). "New conversation" = the next turn with `conversation_id: null`.
- Context for the model: the last 8 turns of that conversation. The panel shows the whole history.

## 3. Actions never run without the owner's yes (or a standing rule)
`POST /assistant/actions/{action_id}/confirm`  body `{decision: "yes"\|"no"}`  (Owner; with the second factor when `needs_second_factor`)
-> `200 {action_id, status: "confirmed"\|"declined", task: {id, status}}`.
- `yes` approves the planned task exactly as `/tasks/{id}/approve` does (one approval for everyone who is not excluded; the existing caps, hours, consent and outbox rules apply). The reply message in the history flips `action.status`.
- `no` cancels the plan. An unanswered plan expires after 30 minutes (`expired`).
- A standing rule (`/outreach` rules, auto-reply) may run an action WITHOUT a tap; then the turn says so in words ("This follows your standing rule: ...") and still returns `confirm_action` with `status: "confirmed"` already. A client must handle `confirm_action.status` = "proposed" (show Yes/No) and anything else (show the state).
- Errors: 403 `mfa_required` (ask for the code, retry), 409 `action_expired`, 409 `action_state`, 404.
- Voice: the orb speaks the plan ("I'll call 12 new leads today. Shall I go ahead?") and the owner may say "yes"/"no" (the server's router recognises a bare yes/no while an action is waiting) or tap the buttons; both end in the same call.

## 4. The voice socket (contract-browser-voice.md) uses the SAME router
- The fast tier and Ask are replaced by the router: `smalltalk` and `general` are answered by the fast model (spoken, short); `business` and `action` go the tool path. The spoken reply is the short version (about 420 characters, whole sentences); the FULL text arrives as captions with `spoken:false`.
- New messages on the socket (additions to contract-browser-voice.md, see that file): `transcript` (interim and final transcripts), `intent`, `confirm_action`, `clarify`, and the client message `confirm` `{action_id, decision}`.

## 5. Caps and cost
The same ledger as Ask (AI allowance, daily and monthly caps, per-run limits). General and small-talk turns use the cheap model and are far cheaper; they still count. No data of another workspace is ever in a prompt.

## 6. Tests the client can rely on
Each turn type has a fixed example in the API tests: `smalltalk` "how are you" -> `answer` with no `source`; `general` "explain GST on sarees" -> `answer`, no tools; `business` "how many enquiries today?" -> `answer` with a `source` or a "no record" sentence + a next step; `action` "call the new leads" -> `confirm_action`; "call" alone -> `clarify`.


## Built, 29 Oct 2026 (what differs from the text above; this section wins)
- `confirm_action` carries two more fields: `status` ("proposed" on a fresh plan; on a replay it is the plan's state now) and `can_confirm` (false for a salesperson: they may ask for a plan, only the Owner says yes). `needs_second_factor` is true only for an Owner/Admin who turned the authenticator on and has not entered the code this session.
- A plan is the task planner's: `action_id` IS the task id (`GET /tasks/{id}` shows the same task; its own screens keep working). `POST /assistant/actions/{id}/confirm` works only on a plan from the caller's own conversation (anything else is 404) and only for the Owner. `yes` after 30 minutes: 409 `action_expired`. Asking `yes` twice gives the same 200. `no` after `yes`: 409 `action_state`.
- Standing rules: not wired in this release (a plan always waits for the yes).
- `clarify`: the next message in the SAME conversation is the answer (the server recognises it; whatever the words are). `action_id` in the event is the task id.
- `language_hint` only decides a message of three words or fewer that has no language of its own ("ok").
- `text` events arrive in pieces after the answer is checked (the model interface is not token-streamed); the checks (cited sources, amounts, names of internal things) come first by design.
- History: `GET /assistant/conversations/{id}` messages now carry `kind` and `action: {action_id, status}|null`. `GET /assistant/conversations` excludes archived conversations and the planner's own bookkeeping conversation.
- A uncited claim about the business: the reply is `NO_RECORD_HELP` ("I could not find a record of that, so I will not guess. Tell me a customer's name, a date or a product and I will look again, or ask me to draft a follow-up.") in the owner's language. Words are drafts for a native reader.
- Schools: a chat that is small talk or general help and mentions fees, marks, results or dues gets the fixed school sentence and no model call. Questions about the school's own fee totals still go the records path (its own child-data rules).
- Voice socket: partial `caption` messages for the user are STILL sent (existing clients); `transcript` is added beside them. `reply {kind:"answer"}` follows a spoken plain answer; `confirm_action` / `clarify` follow the spoken plan/question. A spoken yes/no is heard only while a plan waits; the server then says a short fixed line ("Okay, I will go ahead.") and sends `action`. The server's `error` for a refused yes carries `code` (`mfa_required`, `action_expired`, `action_state`, `forbidden`).
- Rate limit: `/assistant/turns` shares the Ask allowance (20 a minute per account). Billing: a turn and a `yes` are "spend" (held when the workspace is read-only or waiting for WhatsApp).
