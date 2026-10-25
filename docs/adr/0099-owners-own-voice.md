# ADR 0099: the Owner's own voice, with consent (job DP, part 5)

Status: built on branch `api/dp-own-voice` (night run 26 Oct 2026); a FAKE provider only.

## Context
An owner may want the assistant to sound like them. A voice is biometric-like personal data and can be misused, so consent has to be explicit, recorded, provable and revocable, and the assistant must never pretend to be the person.

## Decision
1. **Only the workspace Owner, with a second factor,** can start or delete (database and API). An Admin sees the status; the recordings are readable by the Owner alone (the bucket's storage rules).
2. **Consent is a recorded sentence:** "I, <name>, allow Stack19 to create an AI voice of me for <business>". The database builds the expected sentence from the name and the workspace's name and refuses any other (SM833). The consent recording, the name, the time, the sentence and the workspace are stored; the consent recording is **never sent to the provider**, only the sample is.
3. **The two recordings live in a private bucket per workspace (`ovc-<tenant id>`);** the API uploads them with the Owner's own token (no service key), and the database looks at both objects itself (they exist, they are audio, their sizes) before it records the consent.
4. **No decoder on the server:** a WAV is read and its real length must match the claim; any other type must start like its type and be plausible for the length (1 to 400 kilobytes a second). The spoken sentence is not transcribed or verified (that needs a live speech engine; the typed sentence is checked, the recording is the evidence).
5. **The voice is a persona, `own_voice`,** in Settings > AI assistant. It is selectable only while the voice is ready; per language it maps to a catalogue voice of the workspace (`own-<tenant8>-<lang>`), and the voice notes follow it. The assistant still says it is the AI assistant: the introduction is fixed wording.
6. **"Delete my voice" is ordered so nothing is half done:** the provider's voice first (safe to repeat), then both recordings (checked: they must really be gone, and the database refuses to say "deleted" while one is still there), then the record (name, sentence, paths and provider id erased; the catalogue voices switched off, because the usage ledger keeps its rows; an assistant that used the voice falls back to a stock persona). Any step that fails stops there and the Owner presses delete again.
7. **A refused attempt keeps nothing:** if the provider refuses, the attempt is marked failed and both recordings are removed.
8. **One live voice per workspace.** The record of a deleted voice stays (who consented, when, when deleted) with no name; records are never deleted.

## Consequences
- A real provider is a later adapter behind `app/voice/interface.py: VoiceCloner`; the shapes do not change. It will need the owner's decision on which provider and its terms for cloned voices (where the sample is processed and whether it is kept).
- The consent sentence is English only; a Telugu, Hindi or Kannada sentence needs native review of the wording and an updated check.
- Erasing a workspace erases the name and the sentence (erasure registry); the files go with the bucket's deletion in the workspace erasure job (not built here: today an erased workspace's own-voice files are removed by pressing "Delete my voice" first, which the erasure runbook should say).
