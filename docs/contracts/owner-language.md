# Contract: the owner's language (C1 -> C2), 14 Nov 2026 (owner prompt A and B)

Decision (agreed with C2): **the language of the conversation** decides the words of everything the assistant says to the owner; **the app language** decides the app's menus. They are separate.

## 1. Which language is "the conversation's"
In this order: (1) the language the owner PICKED in the composer / Talk live language pill (`language` in the turn request or `set_language` on the voice socket); (2) else the language the owner last typed or SPOKE (detected by code: script first, then romanised words; a short English word does not switch a Telugu chat back); (3) else the workspace's main language. It is sticky across turns. Codes: `en`, `te`, `hi`, `kn`, `ta`, `ml`, `mr` (`ml` and `mr` fall back to English words where the review sheets are not done yet; the tag still says what was asked).

## 2. The tag
Every assistant payload carries **`language`** (the conversation's language, one of the codes above): the SSE events `reply`, `confirm_action`, `clarify`, `action`, `source`, `error`, the stored chat messages (`GET /assistant/conversations/{id}`), the `work_card` cards, and the voice socket's `caption`, `confirm_action`, `action`, `error`. (Added to the confirm_action payload and the socket frames in the A slice; the other events already carry it or get it in the same slice. Until then C2 may read the language of the last owner turn.)

## 3. Who writes which words
| What | Written by | Notes |
|---|---|---|
| the assistant's answer text (`reply`, spoken `caption`) | C1, in the conversation's language (the model, short spoken sentences, natural Telugu-English mixing for business words) | never markdown or a read-out list |
| plan card `title` ("Call 28 people"), `summary`, `steps[]` (who / how / when lines), `clarify.question` | **C1**, fixed templates per language (app/turns/words.py), no model words about amounts or dates | `title` is short (what and how many) |
| plan card **button words** ("సరే, కాల్ చెయ్యి" / "మార్చు" / "ఆపు" / "రద్దు చెయ్యి"), **undo chip words** ("Undo"), **status lines** ("Working...", "Checking your records...") | **C2**, per language, in the review CSVs | C1 sends CODES: `state.step` (`working`, `searching`, ...), `action.status` (`confirmed`, `declined`, `cancelled`...), `undo.state` |
| **errors** | C1 sends `code` + `message` (English fallback) + `params`; **C2 owns the localized sentence per `code`** (the stable list is `docs/contracts/error-codes.md`) | `ai_paused_until` has `until` (ISO time) in its fields |
| **amounts, times, counts, phones** | structured, formatted by C2 in Indian style | `estimate.cost_paise` -> "₹24,500" (lakh grouping, ₹ always), `when` below -> "సాయంత్రం 6 గంటలకి", `count` -> numerals |
| the card's `steps` "when" line | C1 sends it as text AND structured (below) | C2 prefers the structured one for the time phrase |

## 4. New and changed fields
* `confirm_action` (chat SSE and voice socket) gains `language` and `when: { date: "2026-11-14", from_minute: 600, to_minute: 1140 } | null` (India time, minutes since midnight) next to the existing `steps`. `estimate.cost_paise` stays. `title` is now the short title.
* `action` frames (`{type:"action", action_id, status, task, change?}`) gain `language`.
* `undo` objects keep `{state: "none"|"available"|"done"|"expired", until}`; the *words* of the chip are C2's. What was done is in `summary` (a short sentence in the conversation's language, written by code from the tool's arguments, e.g. "Calling hours set to 10:00 to 19:00").
* Errors inside a turn: `{ "type":"error", "code", "message", "language", "fatal", ...fields }`.

## 5. Friend mode and the owner persona (what C2 should know)
The assistant answers any owner question (general knowledge, festivals, cricket, recipes, advice, offer ideas, small talk) in short spoken sentences; it never says "I can only help with your business". Casual chat never starts an action. Such turns count against the day's AI allowance. Customer-facing calls and WhatsApp stay on the business. There is no UI change except that `intent` frames may say `kind: "smalltalk" | "general"` (a chat bubble with no source chips).
