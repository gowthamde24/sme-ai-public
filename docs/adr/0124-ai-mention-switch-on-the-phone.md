# ADR 0124: the "mention that I'm an AI" switch reaches the phone path (job AI, 11 Nov 2026)

Status: built, staging only. The lawyer's answer that allowed switching the mention off was **verbal on 10 Nov 2026 and is not confirmed in writing**; the safeguards below stay on regardless, and the switch stays default ON.

## Decision
The per-business switch that already exists for the browser voice and previews (`workspace.opening_settings.mention_ai`, ADR 0116, Owner only, audited, default ON) also decides the opening of an **inbound phone call**.

- The phone line reads it through `public.phone_mention_ai_for_call(tenant)` (scheduler account only; no row = ON; unreadable or unclear = ON).
- **OFF changes the opening only in a language whose plain opening a native speaker has reviewed.** Today that is English (`persona.PLAIN_INBOUND_OPENING`). Every other language is **locked ON**: the switch is ignored and the call still says it is an AI. A language is added to the list only after the owner confirms the plain wording.
- OFF + a saved Talk training greeting: the greeting is spoken as the owner wrote it (no AI sentence is put in front). OFF + no greeting: the plain opening.
- `phone_calls.ai_disclosed` now stores what was really said (`gate.has_ai_disclosure` of the opening spoken), not a constant.

## What the switch never changes
1. **The honest-answer rule**: the phone prompt always says the assistant is an AI, says so at once if asked, never claims to be a person and never denies being an AI. With a plain opening an explicit second rule is added ("the opening did not say it; do not bring it up yourself, but answer plainly the moment you are asked").
2. **Calls WE place** (Lead Desk tasks, the owner's test call, the outreach worker): their opening always says it is an AI, and the outbound gate still refuses an opening without it (`no_ai_disclosure`). Not touched; Lead Finder real calls untouched.
3. Outbound only 09:00-21:00 IST, do-not-disturb, consent and the enquiry record, no recording, every change of a switch logged with who and when.

## Not done (held on purpose)
- The privacy text is **not** changed. Its section 4 says calls made for a business "say they come from the business's AI assistant"; with the switch off that sentence needs a qualification. The proposed wording is in the morning report for the owner to read first (privacy version bump with it).
- The web explanation next to the switch should say: it also applies to inbound phone calls in English; other languages always say it; if a caller asks, the assistant always answers truthfully.
- Plain openings for Telugu, Hindi, Kannada, Tamil, Malayalam and Marathi (native review first).
